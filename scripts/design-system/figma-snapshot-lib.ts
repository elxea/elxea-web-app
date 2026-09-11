/**
 * figma-snapshot-lib.ts
 *
 * Shared core for 経済化施策② (Decision Log 39c70c9d064c81079145f69744e7b8f5):
 * a deterministic Figma snapshot + change-manifest that narrows "which pages /
 * nodes changed" so a design-reflection session does NOT have to re-measure the
 * whole Figma file with the LLM MCP every time. O(changed frames) instead of
 * O(whole file).
 *
 * ── SCOPE OF TRUST (read this) ────────────────────────────────────────────
 * The change-manifest is a CHANGE-CANDIDATE NARROWER ONLY. It tells you where to
 * look. It does NOT replace, weaken, or discharge any verification obligation:
 *   - the fidelity gate (EVIDENCE: fidelity-table:<path>) still applies to every
 *     reflected change,
 *   - the DS-instance / ds-instance-report obligations are unchanged,
 *   - "not in the manifest" must NEVER be read as "verified unchanged".
 * See scripts/design-system/snapshots/README.md and the CLI headers.
 *
 * ── QUALITY-AUDIT PROTECTIONS (circl-qa 2026-07-13, condition C4 「silent drop」)
 * A deterministic diff can only surface what the snapshot captured. Silent drop =
 * a designer's change reaching neither code nor any gate. Defenses baked in here:
 *   1. RESOLVED values, not just bindings. We store the resolved paint color /
 *      number that the REST API returns, so a variable *value-only* change (C4-i)
 *      shows up as a modified fill — not invisible behind a binding name.
 *   2. Instance subtrees are captured as returned (resolved). A change inside a
 *      main component that propagates to an instance (C4-ii) appears as modified
 *      nodes inside the instance subtree.
 *   3. fail-loud on partial fetch. If the nodes API returns a null/absent document
 *      for a requested section, we throw (never snapshot a hole silently).
 *   4. explicit exclusion accounting. Sibling sections under Proposals that are
 *      NOT @/<route> proposals are reported with count + reason (no silent
 *      truncation). The diff also surfaces a completeness signal when the file
 *      advanced but the diff is empty (belt-and-suspenders, C4).
 *
 * Read-only: GET only, never writes to Figma. Token via .env.local
 * FIGMA_PERSONAL_ACCESS_TOKEN (same loader as sync-figma-read.ts).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FIGMA_API_BASE = "https://api.figma.com";
export const DEFAULT_FILE_KEY = "AWLnI0XF07e8rScuxPYPc7"; // elxea DS 正本 (Decision Log 36f70c9d)
export const TARGET_PAGE_NAME = "Proposals"; // 部分一致 (figma-page-naming prefix 許容)

// ---------------------------------------------------------------------------
// Token loader (sync-figma-read.ts と同方式)
// ---------------------------------------------------------------------------

export function loadToken(cwd: string = process.cwd()): string {
  const envPath = resolve(cwd, ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    console.error("Error: .env.local not found at", envPath);
    process.exit(1);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "FIGMA_PERSONAL_ACCESS_TOKEN") return value;
  }
  console.error("Error: FIGMA_PERSONAL_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}

export async function figmaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${FIGMA_API_BASE}${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Figma API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Figma REST types (minimal subset we normalize)
// ---------------------------------------------------------------------------

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type?: string;
  visible?: boolean; // default true when omitted
  opacity?: number;
  color?: FigmaColor;
  gradientStops?: Array<{ position: number; color: FigmaColor }>;
  [k: string]: unknown;
}

export interface FigmaEffect {
  type?: string;
  visible?: boolean;
  radius?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  [k: string]: unknown;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  letterSpacing?: number;
  lineHeightPx?: number;
  textAlignHorizontal?: string;
  textCase?: string;
  textDecoration?: string;
  [k: string]: unknown;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  componentId?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  characters?: string;
  style?: FigmaTypeStyle;
  children?: FigmaNode[];
}

export interface FigmaFileShallow {
  name: string;
  lastModified: string;
  document: { children: FigmaNode[] };
}

export interface FigmaNodesResponse {
  nodes: Record<string, { document: FigmaNode } | null>;
}

// ---------------------------------------------------------------------------
// Route extraction (施策① と同一ロジック / figma-ds-instance-rate.ts より)
// ---------------------------------------------------------------------------

const ROUTE_RE = /@\/[A-Za-z0-9\-[\]/]+/g;

export function extractRoute(name: string): string | null {
  const matches = name.match(ROUTE_RE);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

// ---------------------------------------------------------------------------
// Normalization (deterministic)
// ---------------------------------------------------------------------------

/** 座標・寸法・letterSpacing 等の float ノイズを丸める (sub-pixel を安定化)。 */
function round(n: number | undefined, decimals = 2): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** 色は 0..1 レンジ。4 桁で丸めて hex 相当の精度を保ちつつ float ノイズを消す。 */
function normColor(c: FigmaColor | undefined): FigmaColor | undefined {
  if (!c) return undefined;
  return {
    r: round(c.r, 4)!,
    g: round(c.g, 4)!,
    b: round(c.b, 4)!,
    a: round(c.a, 4)!,
  };
}

function normPaint(p: FigmaPaint) {
  const out: Record<string, unknown> = {
    type: p.type,
    // Figma paint は visible 省略時 true。明示的に正規化して diff 安定化。
    visible: p.visible !== false,
  };
  if (p.opacity !== undefined) out.opacity = round(p.opacity, 4);
  const color = normColor(p.color);
  if (color) out.color = color;
  if (Array.isArray(p.gradientStops)) {
    out.gradientStops = p.gradientStops.map((s) => ({
      position: round(s.position, 4),
      color: normColor(s.color),
    }));
  }
  return out;
}

function normEffect(e: FigmaEffect) {
  const out: Record<string, unknown> = {
    type: e.type,
    visible: e.visible !== false,
  };
  if (e.radius !== undefined) out.radius = round(e.radius, 2);
  const color = normColor(e.color);
  if (color) out.color = color;
  if (e.offset) out.offset = { x: round(e.offset.x, 2), y: round(e.offset.y, 2) };
  return out;
}

export interface NormalizedNode {
  id: string;
  route: string;
  name: string;
  type: string;
  props: Record<string, unknown>;
}

/**
 * 1 ノードを決定論的な正規化レコードに落とす。
 * - 「resolved 値」を保存する (binding 名ではなく解決済み color/number)。C4-i 対策。
 * - undefined フィールドは省略 (欠落と null を区別)。
 * - props に含めるのは「変更を検知したい設計属性」に限定 (id/route/name/type は上位)。
 */
export function normalizeNode(n: FigmaNode, route: string): NormalizedNode {
  const props: Record<string, unknown> = {};

  if (n.visible === false) props.visible = false; // 既定 true。false のときだけ記録。
  if (n.opacity !== undefined && n.opacity !== 1) props.opacity = round(n.opacity, 4);
  if (n.componentId) props.componentId = n.componentId; // INSTANCE→main の紐付け

  const bb = n.absoluteBoundingBox;
  if (bb) {
    props.box = {
      x: round(bb.x),
      y: round(bb.y),
      w: round(bb.width),
      h: round(bb.height),
    };
  }

  if (Array.isArray(n.fills) && n.fills.length > 0)
    props.fills = n.fills.map(normPaint);
  if (Array.isArray(n.strokes) && n.strokes.length > 0)
    props.strokes = n.strokes.map(normPaint);
  if (n.strokeWeight !== undefined) props.strokeWeight = round(n.strokeWeight, 2);
  if (Array.isArray(n.effects) && n.effects.length > 0)
    props.effects = n.effects.map(normEffect);

  if (n.cornerRadius !== undefined) props.cornerRadius = round(n.cornerRadius, 2);
  if (Array.isArray(n.rectangleCornerRadii))
    props.rectangleCornerRadii = n.rectangleCornerRadii.map((r) => round(r, 2));

  if (n.layoutMode) props.layoutMode = n.layoutMode;
  if (n.itemSpacing !== undefined) props.itemSpacing = round(n.itemSpacing, 2);
  if (n.paddingLeft !== undefined) props.paddingLeft = round(n.paddingLeft, 2);
  if (n.paddingRight !== undefined) props.paddingRight = round(n.paddingRight, 2);
  if (n.paddingTop !== undefined) props.paddingTop = round(n.paddingTop, 2);
  if (n.paddingBottom !== undefined) props.paddingBottom = round(n.paddingBottom, 2);
  if (n.primaryAxisAlignItems) props.primaryAxisAlignItems = n.primaryAxisAlignItems;
  if (n.counterAxisAlignItems) props.counterAxisAlignItems = n.counterAxisAlignItems;

  if (typeof n.characters === "string") props.characters = n.characters;
  if (n.style) {
    const s = n.style;
    const ts: Record<string, unknown> = {};
    if (s.fontFamily) ts.fontFamily = s.fontFamily;
    if (s.fontPostScriptName) ts.fontPostScriptName = s.fontPostScriptName;
    if (s.fontWeight !== undefined) ts.fontWeight = s.fontWeight;
    if (s.fontSize !== undefined) ts.fontSize = round(s.fontSize, 2);
    if (s.letterSpacing !== undefined) ts.letterSpacing = round(s.letterSpacing, 3);
    if (s.lineHeightPx !== undefined) ts.lineHeightPx = round(s.lineHeightPx, 2);
    if (s.textAlignHorizontal) ts.textAlignHorizontal = s.textAlignHorizontal;
    if (s.textCase) ts.textCase = s.textCase;
    if (s.textDecoration) ts.textDecoration = s.textDecoration;
    if (Object.keys(ts).length > 0) props.textStyle = ts;
  }

  return { id: n.id, route, name: n.name, type: n.type, props };
}

/**
 * section subtree を全走査し、id キーの正規化 map を構築する。
 * 【重要】走査に深さ上限・件数上限を設けない (silent truncation 禁止 / C4)。
 * INSTANCE 内部にも降下する: resolved instance subtree を保存し、main→instance の
 * 波及変更 (C4-ii) を per-instance の modified として検知できるようにする。
 */
export function walkSection(
  root: FigmaNode,
  route: string,
  out: Record<string, NormalizedNode>
): void {
  const walk = (n: FigmaNode) => {
    out[n.id] = normalizeNode(n, route);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

export interface Snapshot {
  tool: "figma-snapshot";
  schema_version: 1;
  file_key: string;
  file_name: string;
  /** 情報用メタ。diff 対象ではない (volatile: 取得ごとに変わる)。 */
  meta: {
    captured_at: string;
    file_last_modified: string;
    page: { id: string; name: string };
  };
  /** @/<route> でない Proposals 直下 section を明示除外 (silent truncation 禁止)。 */
  excluded: {
    reason: string;
    sections_without_route: Array<{ id: string; name: string }>;
  };
  /** id → 正規化ノード。決定論 diff の対象はここだけ。 */
  nodes: Record<string, NormalizedNode>;
  counts: {
    routes: number;
    nodes: number;
    excluded_sections: number;
  };
}

export interface ProposalFetch {
  fileName: string;
  fileLastModified: string;
  page: { id: string; name: string };
  routeSections: Array<{ id: string; route: string }>;
  sectionsWithoutRoute: Array<{ id: string; name: string }>;
  /** 各 route section の full subtree document (nodes API より)。 */
  sectionDocs: Record<string, FigmaNode>;
}

/**
 * Proposals ページを特定し、@/<route> section を列挙、その full subtree を取得する。
 * fail-loud: ページ不在 / 母集団ゼロ / nodes API の document 欠落 は throw。
 */
export async function fetchProposalSections(
  fileKey: string,
  token: string
): Promise<ProposalFetch> {
  const shallow = await figmaGet<FigmaFileShallow>(
    `/v1/files/${fileKey}?depth=2`,
    token
  );
  const pages = shallow.document.children.filter((p) => p.type === "CANVAS");
  const proposalPages = pages.filter((p) =>
    p.name.toLowerCase().includes(TARGET_PAGE_NAME.toLowerCase())
  );
  if (proposalPages.length !== 1) {
    throw new Error(
      `expected exactly 1 page matching "${TARGET_PAGE_NAME}", found ${proposalPages.length}: ` +
        pages.map((p) => JSON.stringify(p.name)).join(", ")
    );
  }
  const page = proposalPages[0];

  const routeSections: Array<{ id: string; route: string }> = [];
  const sectionsWithoutRoute: Array<{ id: string; name: string }> = [];
  for (const c of page.children ?? []) {
    const route = extractRoute(c.name);
    if (route) routeSections.push({ id: c.id, route });
    else sectionsWithoutRoute.push({ id: c.id, name: c.name });
  }
  if (routeSections.length === 0) {
    throw new Error(
      `no "@/<route>" named sections under page "${page.name}" (fail-loud: 母集団ゼロは取得不能)`
    );
  }

  const sectionDocs: Record<string, FigmaNode> = {};
  const ids = routeSections.map((s) => s.id);
  const CHUNK = 20;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const resp = await figmaGet<FigmaNodesResponse>(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(chunk.join(","))}`,
      token
    );
    for (const id of chunk) {
      const entry = resp.nodes[id];
      // fail-loud: 部分取得 / null document を穴として黙認しない (C4 protection #3)
      if (!entry?.document) {
        throw new Error(
          `nodes API returned no document for section id=${id} (partial fetch — refusing to snapshot a hole)`
        );
      }
      sectionDocs[id] = entry.document;
    }
  }

  return {
    fileName: shallow.name,
    fileLastModified: shallow.lastModified,
    page: { id: page.id, name: page.name },
    routeSections,
    sectionsWithoutRoute,
    sectionDocs,
  };
}

export function buildSnapshot(fetched: ProposalFetch, fileKey: string): Snapshot {
  const nodes: Record<string, NormalizedNode> = {};
  for (const s of fetched.routeSections) {
    walkSection(fetched.sectionDocs[s.id], s.route, nodes);
  }
  return {
    tool: "figma-snapshot",
    schema_version: 1,
    file_key: fileKey,
    file_name: fetched.fileName,
    meta: {
      captured_at: new Date().toISOString(),
      file_last_modified: fetched.fileLastModified,
      page: fetched.page,
    },
    excluded: {
      reason:
        "Proposals 直下の兄弟 section のうち @/<route> 命名でないもの (route proposal ではない: 表紙/凡例/作業メモ等) は母集団対象外。silent truncation を避けるため件数と id/name を明示。",
      sections_without_route: fetched.sectionsWithoutRoute,
    },
    nodes,
    counts: {
      routes: fetched.routeSections.length,
      nodes: Object.keys(nodes).length,
      excluded_sections: fetched.sectionsWithoutRoute.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic serialization (sorted keys → stable file / stable diff)
// ---------------------------------------------------------------------------

/** キーをソートして JSON.stringify する。順序に依存しない安定出力。 */
export function stableStringify(value: unknown, indent = 0): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) throw new Error("circular reference");
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = norm(o[k]);
    return sorted;
  };
  return JSON.stringify(norm(value), null, indent);
}

/** snapshot ファイル用の決定論シリアライズ (nodes を id ソートで安定化)。 */
export function serializeSnapshot(snap: Snapshot): string {
  return stableStringify(snap, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface ModifiedEntry {
  id: string;
  route: string;
  name: string;
  type: string;
  changed_fields: FieldChange[];
}

export interface NodeRef {
  id: string;
  route: string;
  name: string;
  type: string;
}

export interface SnapshotDiff {
  added: NodeRef[];
  removed: NodeRef[];
  modified: ModifiedEntry[];
  unchanged: number;
}

/** 2 レコードの再帰 field 差分。dotted path で from/to を列挙。 */
function diffValue(path: string, a: unknown, b: unknown, out: FieldChange[]): void {
  if (stableStringify(a) === stableStringify(b)) return;
  const aObj = a !== null && typeof a === "object" && !Array.isArray(a);
  const bObj = b !== null && typeof b === "object" && !Array.isArray(b);
  if (aObj && bObj) {
    const keys = new Set([
      ...Object.keys(a as object),
      ...Object.keys(b as object),
    ]);
    for (const k of [...keys].sort()) {
      diffValue(
        path ? `${path}.${k}` : k,
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        out
      );
    }
    return;
  }
  // 配列・プリミティブ・型不一致は leaf として from/to を記録。
  out.push({ path, from: a, to: b });
}

export function diffSnapshots(
  baseline: Record<string, NormalizedNode>,
  live: Record<string, NormalizedNode>
): SnapshotDiff {
  const added: NodeRef[] = [];
  const removed: NodeRef[] = [];
  const modified: ModifiedEntry[] = [];
  let unchanged = 0;

  const ref = (n: NormalizedNode): NodeRef => ({
    id: n.id,
    route: n.route,
    name: n.name,
    type: n.type,
  });

  for (const id of Object.keys(live).sort()) {
    const l = live[id];
    const b = baseline[id];
    if (!b) {
      added.push(ref(l));
      continue;
    }
    if (stableStringify(b) === stableStringify(l)) {
      unchanged += 1;
      continue;
    }
    const changed: FieldChange[] = [];
    // name/type/route も設計上の変更なので diff 対象に含める。
    diffValue("name", b.name, l.name, changed);
    diffValue("type", b.type, l.type, changed);
    diffValue("route", b.route, l.route, changed);
    diffValue("props", b.props, l.props, changed);
    modified.push({
      id: l.id,
      route: l.route,
      name: l.name,
      type: l.type,
      changed_fields: changed,
    });
  }
  for (const id of Object.keys(baseline).sort()) {
    if (!live[id]) removed.push(ref(baseline[id]));
  }

  return { added, removed, modified, unchanged };
}
