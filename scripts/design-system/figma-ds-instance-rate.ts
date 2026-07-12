/**
 * figma-ds-instance-rate.ts
 *
 * デザイン・ドリフト週次検査① (design-drift-weekly / drift-audit-runner check#19):
 * Proposals ページ配下の `@<route>` 命名セクションごとに DS インスタンス化率を
 * 決定論的に計測して JSON 出力する (計測のみ。合否判定・baseline 管理は
 * ~/.config/admin-pipeline/scripts/drift-audit-design.sh 側の責務)。
 *
 * Metric (決定論・安定):
 *   各 @route セクション配下を走査し、
 *     - INSTANCE ノード = DS コンポーネント由来としてカウントし、内部には降下しない
 *       (インスタンス内部は DS 提供物であり手描き分母に含めない)
 *     - それ以外の全ノード = 手描き候補として分母にカウントし降下する
 *   rate = instances / total (total = instances + non-instance nodes)
 *
 * 合否は baseline 比較方式 (Boss 判断 2026-07-11): 初回実測値を baseline に記録し
 * 低下したら Fail。絶対閾値は設けない (DS 是正進行中のため)。
 * TODO(設計メモ): DS 是正完了後に絶対閾値 95% を追加する。
 *
 * Usage:
 *   FIGMA_FILE_KEY=xxx npx tsx scripts/design-system/figma-ds-instance-rate.ts --json
 *   npx tsx scripts/design-system/figma-ds-instance-rate.ts --file-key xxx --json
 *
 * FIGMA_FILE_KEY は必須 (env or --file-key)。default fallback は持たない (fail-loud)。
 * Token は .env.local の FIGMA_PERSONAL_ACCESS_TOKEN (sync-figma-read.ts と同方式)。
 * Read-only: Figma への書き込みは一切ない (GET のみ)。
 *
 * Exit codes: 0=計測成功 / 1=致命 (token/API/ページ不在)。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIGMA_API_BASE = "https://api.figma.com";
const TARGET_PAGE_NAME = "Proposals"; // 部分一致 (figma-page-naming の prefix 許容)

// ---------------------------------------------------------------------------
// Token loader (sync-figma-read.ts と同方式)
// ---------------------------------------------------------------------------

function loadToken(): string {
  const envPath = resolve(process.cwd(), ".env.local");
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
    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "FIGMA_PERSONAL_ACCESS_TOKEN") return value;
  }
  console.error("Error: FIGMA_PERSONAL_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${FIGMA_API_BASE}${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types (minimal subset)
// ---------------------------------------------------------------------------

interface FigmaPaint {
  visible?: boolean; // Figma default true when omitted
  [k: string]: unknown;
}

interface FigmaEffect {
  visible?: boolean; // Figma default true when omitted
  [k: string]: unknown;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  componentId?: string;
  children?: FigmaNode[];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  effects?: FigmaEffect[];
}

interface FigmaFileShallow {
  name: string;
  lastModified: string;
  document: { children: FigmaNode[] };
}

interface FigmaNodesResponse {
  nodes: Record<string, { document: FigmaNode } | null>;
}

interface RouteMeasurement {
  name: string;
  node_id: string;
  node_type: string;
  instances: number;
  total: number;
  rate: number;
  wrapper_excluded: number;
}

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------

/**
 * 無装飾判定: fill / stroke / effect のいずれも「可視」を持たない。
 * Figma の paint/effect は visible 省略時 true。空配列 / 全 invisible を無装飾とみなす。
 * GROUP は自前の fills/strokes/effects を持たない純コンテナのため常に無装飾。
 */
function hasVisiblePaint(arr: FigmaPaint[] | FigmaEffect[] | undefined): boolean {
  if (!arr || arr.length === 0) return false;
  return arr.some((p) => p.visible !== false);
}

export function isUndecorated(n: FigmaNode): boolean {
  return (
    !hasVisiblePaint(n.fills) &&
    !hasVisiblePaint(n.strokes) &&
    !hasVisiblePaint(n.effects)
  );
}

function hasDirectInstanceChild(n: FigmaNode): boolean {
  return (n.children ?? []).some((c) => c.type === "INSTANCE");
}

/**
 * wrapper 判定 (監査提案 / Boss 承認済 2026-07-13):
 * INSTANCE を直下に内包する無装飾 FRAME/GROUP は「レイアウト用の器」であり
 * 手描き成果物ではないため、素描き母集団 (total = 分母) から除外する。
 * 除外は total を数えないだけで、子孫 (内包 INSTANCE 等) には通常どおり降下する。
 * silent 除外にしないため wrapper_excluded として件数を別掲する。
 */
export function isWrapper(n: FigmaNode): boolean {
  return (
    (n.type === "FRAME" || n.type === "GROUP") &&
    isUndecorated(n) &&
    hasDirectInstanceChild(n)
  );
}

export function measure(node: FigmaNode): {
  instances: number;
  total: number;
  wrapper_excluded: number;
} {
  let instances = 0;
  let total = 0;
  let wrapperExcluded = 0;
  const walk = (n: FigmaNode) => {
    if (n.type === "INSTANCE") {
      instances += 1;
      total += 1;
      return; // インスタンス内部には降下しない (DS 提供物)
    }
    if (isWrapper(n)) {
      // 無装飾 wrapper は分母に数えない。件数は別掲し、子には降下する。
      wrapperExcluded += 1;
      for (const c of n.children ?? []) walk(c);
      return;
    }
    total += 1;
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of node.children ?? []) walk(c);
  return { instances, total, wrapper_excluded: wrapperExcluded };
}

// ---------------------------------------------------------------------------
// Route 抽出 (Boss 判断 2026-07-13: Figma 改名ではなくスクリプト側で吸収)
// ---------------------------------------------------------------------------

/**
 * セクション名の任意位置にある `@/<route>` パターンを抽出する。
 * 実運用の命名は route を末尾に持つ (例:
 *   "商品一覧 変A（部品ベース）— PC/SP @/ja/products")
 * ため、旧来の startsWith("@") 判定では 0 件になっていた。
 * 動的セグメント `[slug]` も拾えるよう `[` `]` を文字クラスに含める。
 * 1 セクション内に複数マッチした場合は最後のものを採用する。
 * マッチしないセクションは母集団対象外 (null)。
 */
const ROUTE_RE = /@\/[A-Za-z0-9\-[\]/]+/g;

export function extractRoute(name: string): string | null {
  const matches = name.match(ROUTE_RE);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const fkIdx = args.indexOf("--file-key");
  const fileKey =
    (fkIdx >= 0 ? args[fkIdx + 1] : undefined) || process.env.FIGMA_FILE_KEY;
  if (!fileKey) {
    console.error(
      "Error: FIGMA_FILE_KEY is required (env FIGMA_FILE_KEY or --file-key). No default (fail-loud)."
    );
    process.exit(1);
  }

  const token = loadToken();

  // 1) 浅い取得でページ一覧 → Proposals ページ特定 (depth=2 でページ直下の子まで)
  const shallow = await figmaGet<FigmaFileShallow>(
    `/v1/files/${fileKey}?depth=2`,
    token
  );
  const pages = shallow.document.children.filter((p) => p.type === "CANVAS");
  const proposalPages = pages.filter((p) =>
    p.name.toLowerCase().includes(TARGET_PAGE_NAME.toLowerCase())
  );
  if (proposalPages.length !== 1) {
    console.error(
      `Error: expected exactly 1 page matching "${TARGET_PAGE_NAME}", found ${proposalPages.length}: ` +
        pages.map((p) => JSON.stringify(p.name)).join(", ")
    );
    process.exit(1);
  }
  const page = proposalPages[0];

  // 2) ページ直下から `@/<route>` を名前の任意位置に持つセクションを列挙する。
  //    route は末尾に置かれる運用 (例 "... — PC/SP @/ja/products") のため、
  //    name 全体から extractRoute で抽出する (type 不問)。
  const routeSections = (page.children ?? [])
    .map((c) => ({ node: c, route: extractRoute(c.name) }))
    .filter((x): x is { node: FigmaNode; route: string } => x.route !== null);
  if (routeSections.length === 0) {
    console.error(
      `Error: no "@/<route>" named sections found under page "${page.name}" (fail-loud: 母集団ゼロは計測不能として扱う)`
    );
    process.exit(1);
  }

  // 3) 各セクションのフル subtree を nodes API で取得 (chunk して URL 長超過を回避)
  const sectionDocs: Record<string, FigmaNode> = {};
  const ids = routeSections.map((s) => s.node.id);
  const CHUNK = 20;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const resp = await figmaGet<FigmaNodesResponse>(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(chunk.join(","))}`,
      token
    );
    for (const id of chunk) {
      const entry = resp.nodes[id];
      if (!entry?.document) {
        console.error(`Error: nodes API returned no document for section id=${id}`);
        process.exit(1);
      }
      sectionDocs[id] = entry.document;
    }
  }

  // 4) 計測
  const routes: RouteMeasurement[] = routeSections.map((s) => {
    const doc = sectionDocs[s.node.id];
    const { instances, total, wrapper_excluded } = measure(doc);
    return {
      name: s.route,
      node_id: s.node.id,
      node_type: doc.type,
      instances,
      total,
      rate: total > 0 ? Math.round((instances / total) * 10000) / 10000 : 0,
      wrapper_excluded,
    };
  });
  routes.sort((a, b) => a.name.localeCompare(b.name));

  const report = {
    tool: "figma-ds-instance-rate",
    metric:
      "instances / total; INSTANCE は内部非降下で 1 カウント、非 INSTANCE 全ノードが分母",
    file_key: fileKey,
    file_name: shallow.name,
    last_modified: shallow.lastModified,
    page: { id: page.id, name: page.name },
    measured_at: new Date().toISOString(),
    routes,
    summary: {
      route_count: routes.length,
      min_rate: Math.min(...routes.map((r) => r.rate)),
      max_rate: Math.max(...routes.map((r) => r.rate)),
      wrapper_excluded_total: routes.reduce(
        (acc, r) => acc + r.wrapper_excluded,
        0
      ),
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`DS instance rate — ${report.file_name} / ${page.name}`);
  for (const r of routes) {
    const wrap = r.wrapper_excluded > 0 ? ` [wrapper-excluded: ${r.wrapper_excluded}]` : "";
    console.log(
      `  ${r.name}: ${(r.rate * 100).toFixed(1)}% (${r.instances}/${r.total})${wrap}`
    );
  }
  console.log(
    `  wrapper-excluded total: ${report.summary.wrapper_excluded_total}`
  );
}

// エントリポイントとして起動されたときのみ main() を実行する。
// (fixture 単体テストが measure 等を import しても main を走らせないため)
const isEntrypoint =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
