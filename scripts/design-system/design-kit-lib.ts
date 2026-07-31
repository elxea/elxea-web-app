/**
 * design-kit-lib.ts
 *
 * Shared library for generate-design-kit.ts / validate-design-kit.ts.
 *
 * Builds the elxea Web App design-kit JSON **from code**, so that the kit can
 * never silently drift from the values it claims to document.
 *
 * Split of responsibility (this is the whole point of the file):
 *
 *   - MACHINE-DERIVED (this file reads the code and emits it):
 *       generated_at / value_sot.primary / tokens / breakpoints.code_*
 *       / counts / conflicts (auto-detected subset)
 *
 *   - HUMAN-MAINTAINED (design-kit.manual.json, merged in here):
 *       file_identity / project / generator / components (Figma node IDs)
 *       / non_negotiables / accepted_np / conflicts (manual subset)
 *       / known_gaps / spec_refs / prose annotations
 *
 * The merge is *non-clobbering*: a manual annotation may only ADD a key that
 * the generator does not emit at that path. If a human writes a value that
 * shadows a code-derived value, the build fails. That is what makes "the kit
 * cannot lie about a token value" a mechanical property rather than a promise.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ROOT = resolve(__dirname, "../..");
export const MANUAL_PATH = resolve(__dirname, "design-kit.manual.json");

/**
 * In-repo committed mirror. This is what CI diffs against (the canonical
 * deliverables path below lives outside the repo and is not available in CI).
 */
export const REPO_MIRROR_PATH = resolve(__dirname, "design-kit.generated.json");

/**
 * Canonical deliverables path (Design Ops Spec v18 §00 naming rule).
 * Single point of definition; override with DESIGN_KIT_OUTPUT.
 */
export const DELIVERABLE_PATH =
  process.env.DESIGN_KIT_OUTPUT ??
  resolve(
    process.env.HOME ?? "",
    ".claude/progress/deliverables/elxea-web-app-design-kit.json",
  );

const SD_CONFIG_PATH = resolve(ROOT, "sd.config.mjs");
const TOKENS_DIR = resolve(ROOT, "tokens");
const GLOBALS_CSS_PATH = resolve(ROOT, "app/globals.css");
const UI_DIR = resolve(ROOT, "components/ui");

/** Fields whose value legitimately changes on every run. */
export const VOLATILE_PLACEHOLDER = "(volatile — normalized in repo mirror)";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = unknown;
type JsonObject = Record<string, Json>;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function isPlainObject(v: Json): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "(git unavailable)";
  }
}

/**
 * Non-clobbering deep merge. `overlay` may only introduce keys absent from
 * `base`. Collisions are reported (and abort the build) rather than silently
 * letting a hand-written value override a code-derived one.
 */
export function mergeAnnotations(
  base: Json,
  overlay: Json,
  path: string,
  collisions: string[],
): Json {
  if (overlay === undefined) return base;
  if (base === undefined) return overlay;
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    collisions.push(path);
    return base;
  }
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in out)) {
      out[key] = value;
    } else {
      out[key] = mergeAnnotations(out[key], value, childPath, collisions);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DTCG token flattening
// ---------------------------------------------------------------------------

function isDtcgLeaf(v: Json): v is JsonObject {
  return isPlainObject(v) && "$value" in v;
}

/**
 * DTCG shadow objects -> the CSS string Style Dictionary emits.
 * Keeps the kit showing the value that actually lands in dist/tokens.css.
 */
function serializeShadow(value: Json): Json {
  const one = (s: Json): string => {
    if (!isPlainObject(s)) return String(s);
    const parts = [s.offsetX, s.offsetY, s.blur, s.spread]
      .filter((p) => p !== undefined)
      .map((p) => String(p).replace(/^0px$/, "0"));
    return `${parts.join(" ")} ${String(s.color ?? "")}`.trim();
  };
  if (Array.isArray(value)) return value.map(one).join(", ");
  if (isPlainObject(value) && "offsetX" in value) return one(value);
  return value;
}

/**
 * Recursively unwraps a W3C DTCG tree into a plain value tree.
 * `$type` is inheritable in DTCG (declared on a group, applies to its leaves),
 * so it is threaded down rather than read off the leaf alone.
 */
function unwrapTokens(node: Json, inheritedType?: string): Json {
  if (isDtcgLeaf(node)) {
    const value = node.$value as Json;
    const type = (node.$type as string | undefined) ?? inheritedType;
    return type === "shadow" ? serializeShadow(value) : value;
  }
  if (!isPlainObject(node)) return node;
  const type = (node.$type as string | undefined) ?? inheritedType;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    out[key] = unwrapTokens(value, type);
  }
  return out;
}

/** Reproduces sd.config.mjs `name/tailwind-compat`. Keep in sync with it. */
export function cssVarName(path: string[]): string {
  const p = [...path];
  if (p[0] === "color" && p[1] === "semantic") p.splice(1, 1);
  return `--${p.join("-")}`;
}

/** Walks a DTCG tree and yields [path, value] for every leaf. */
function walkLeaves(node: Json, path: string[] = []): Array<[string[], Json]> {
  if (isDtcgLeaf(node)) return [[path, node.$value as Json]];
  if (!isPlainObject(node)) return [];
  const out: Array<[string[], Json]> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    out.push(...walkLeaves(value, [...path, key]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------

/** Extracts the `source: [...]` arrays declared in sd.config.mjs. */
export function readStyleDictionarySources(): string[] {
  const src = readFileSync(SD_CONFIG_PATH, "utf8");
  const sources: string[] = [];
  for (const match of src.matchAll(/source:\s*\[([^\]]*)\]/g)) {
    for (const entry of match[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      sources.push(entry[1]);
    }
  }
  return sources;
}

/** Every tokens/**\/*.json file present on disk, repo-relative. */
export function listTokenFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) out.push(relative(ROOT, full));
    }
  };
  walk(TOKENS_DIR);
  return out;
}

/** Bare `--x: y` custom properties declared outside @theme in globals.css. */
function readGlobalsCssVars(): JsonObject {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
  const out: JsonObject = {};
  // :root { ... } blocks (includes the .dark override block, keyed separately)
  for (const block of css.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)) {
    const scope = block[1] === ":root" ? "root" : "dark";
    const vars: JsonObject = {};
    for (const decl of block[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      vars[decl[1]] = decl[2].trim();
    }
    if (Object.keys(vars).length > 0) {
      out[scope] = { ...(out[scope] as JsonObject | undefined), ...vars };
    }
  }
  // @theme inline { ... } aliases
  const themeInline = css.match(/@theme\s+inline\s*\{([^}]*)\}/);
  if (themeInline) {
    const vars: JsonObject = {};
    for (const decl of themeInline[1].matchAll(
      /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi,
    )) {
      vars[decl[1]] = decl[2].trim();
    }
    out["theme_inline"] = vars;
  }
  return out;
}

/** cva variant/size keys declared in a components/ui/*.tsx file. */
function readCvaKeys(file: string, group: string): string[] {
  const path = resolve(UI_DIR, file);
  if (!existsSync(path)) return [];
  const src = readFileSync(path, "utf8");
  const groupMatch = src.match(
    new RegExp(`${group}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s{4,6}\\}`),
  );
  if (!groupMatch) return [];
  const keys: string[] = [];
  for (const m of groupMatch[1].matchAll(/^\s{6,8}["']?([a-zA-Z0-9_-]+)["']?\s*:/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

/** components/ui/*.tsx basenames (excluding stories/tests). */
function listUiComponents(): string[] {
  if (!existsSync(UI_DIR)) return [];
  return readdirSync(UI_DIR)
    .filter(
      (f) =>
        f.endsWith(".tsx") &&
        !f.endsWith(".stories.tsx") &&
        !f.endsWith(".test.tsx"),
    )
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildTokens(base: JsonObject, cjk: JsonObject): JsonObject {
  const unwrapped = unwrapTokens(base) as JsonObject;
  const group = (name: string): JsonObject =>
    (unwrapped[name] as JsonObject | undefined) ?? {};

  // color: keep the {value, css_var} shape (annotations attach hex_note etc.)
  const color: JsonObject = {};
  for (const [name, sub] of Object.entries(group("color"))) {
    const entries: JsonObject = {};
    for (const [token, value] of Object.entries(sub as JsonObject)) {
      entries[token] = { value, css_var: cssVarName(["color", name, token]) };
    }
    color[name] = entries;
  }

  const spacingScale = group("spacing");
  const numericSteps = Object.entries(spacingScale)
    .map(([k, v]) => [Number(k), String(v)] as const)
    .filter(([k, v]) => Number.isFinite(k) && k > 0 && v.endsWith("rem"))
    .sort((a, b) => a[0] - b[0]);
  const smallestStepRem = numericSteps.length
    ? parseFloat(numericSteps[0][1]) / numericSteps[0][0]
    : 0;

  const shape = group("shape");
  const elevation = group("elevation");
  const { shadow, ...elevationRest } = elevation as {
    shadow?: Json;
    [k: string]: Json;
  };

  const sources = readStyleDictionarySources();

  return {
    _generated: {
      _rule:
        "本セクションはコードから機械生成される。手で編集しても pnpm generate:design-kit で上書きされ、pnpm validate:design-kit が CI で落とす。",
      built_sources: sources,
      build_command: "pnpm build:tokens (= node sd.config.mjs)",
      css_outputs: ["dist/tokens.css", "dist/tokens-cjk.css"],
      name_transform:
        "sd.config.mjs の name/tailwind-compat が color.semantic.* から semantic を除去する (color.semantic.primary -> --color-primary)。他はパス連結。",
      token_count: walkLeaves(base).length + walkLeaves(cjk).length,
    },
    color,
    typography: group("typography"),
    spacing: {
      base_unit_px: Math.round(smallestStepRem * 16),
      scale_rem: spacingScale,
    },
    radius: {
      css_var_prefix: "--shape-radius-*",
      values: (shape["radius"] as JsonObject) ?? {},
    },
    border_width: {
      css_var_prefix: "--shape-borderWidth-*",
      values: (shape["borderWidth"] as JsonObject) ?? {},
    },
    shadow: (shadow as JsonObject) ?? {},
    elevation: elevationRest as JsonObject,
    motion: group("motion"),
    media: group("media"),
    component_tokens: group("component"),
    cjk_overrides: {
      _rule:
        "tokens/overrides/cjk.json -> dist/tokens-cjk.css の :lang(ja) ブロック。日本語画面の実効タイポはこちら (base.json ではない)。",
      selector: ":lang(ja)",
      style: (unwrapTokens(cjk) as JsonObject)["typography"] ?? {},
    },
    css_root_vars: {
      _rule:
        "app/globals.css に直書きされた素の CSS 変数 (Style Dictionary を通っていない)。",
      ...readGlobalsCssVars(),
    },
  };
}

function buildBreakpoints(base: JsonObject): JsonObject {
  const layout = (unwrapTokens(base) as JsonObject)["layout"] as
    | JsonObject
    | undefined;
  return {
    code_bp: {
      _source: "tokens/base.json layout.breakpoint",
      ...((layout?.["breakpoint"] as JsonObject) ?? {}),
    },
    code_grid: {
      _source: "tokens/base.json layout.grid",
      ...((layout?.["grid"] as JsonObject) ?? {}),
    },
    code_container: {
      _source: "tokens/base.json layout.container",
      ...((layout?.["container"] as JsonObject) ?? {}),
    },
  };
}

function buildValueSotPrimary(volatile: boolean): JsonObject {
  const sources = readStyleDictionarySources();
  const tokenFiles = listTokenFiles().map((f) => ({
    path: f,
    built: sources.includes(f),
  }));
  const pkg = readJson(resolve(ROOT, "package.json"));
  const scripts = (pkg["scripts"] as Record<string, string>) ?? {};
  // NOTE: no absolute path and no branch/commit in the stable output — those
  // differ per checkout (worktree, CI runner) and would make the drift check
  // fail for reasons that have nothing to do with design values.
  return {
    type: "code_repo",
    git_ref: volatile
      ? git(["rev-parse", "--abbrev-ref", "HEAD"])
      : VOLATILE_PLACEHOLDER,
    head_commit_at_read: volatile
      ? git(["log", "-1", "--pretty=%h %s"])
      : VOLATILE_PLACEHOLDER,
    token_files: tokenFiles,
    build_command: `pnpm build:tokens (= ${scripts["build:tokens"] ?? "?"})`,
    generated_from: [
      "tokens/base.json",
      "tokens/overrides/cjk.json",
      "app/globals.css",
      "sd.config.mjs",
      "components/ui/*.tsx",
      "package.json",
    ],
  };
}

/**
 * Auto-detected conflicts. Currently one rule, and it is the one that caused
 * the incident this whole script exists to prevent: a tokens/*.json file that
 * looks authoritative but is not in sd.config.mjs `source`, so not one byte of
 * it reaches the CSS.
 */
function buildAutoConflicts(): JsonObject[] {
  const sources = readStyleDictionarySources();
  const out: JsonObject[] = [];
  for (const file of listTokenFiles()) {
    if (sources.includes(file)) continue;
    let meta = "";
    try {
      const parsed = readJson(resolve(ROOT, file));
      const m = parsed["$meta"] as JsonObject | undefined;
      if (m) {
        meta = ` ($meta: ${Object.entries(m)
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .map(([k, v]) => `${k}=${v}`)
          .join(" / ")})`;
      }
    } catch {
      /* unparseable token file — still report the build-exclusion */
    }
    out.push({
      id: `c-auto-unbuilt-${file.replace(/[/.]/g, "-")}`,
      severity: "HIGH",
      detected_by: "generate-design-kit.ts (自動検出)",
      title: `${file} がビルドパイプラインに入っていない`,
      code_value: `sd.config.mjs の source は [${sources.join(", ")}] のみ。${file} は含まれない。`,
      other_value: `${file} は存在し現役に見える${meta}。`,
      impact: `${file} の値を『実装値』と信じて読むと外す。CSS には 1 バイトも出ていない。`,
      resolution:
        "オーナー判断待ち。削除も統合もせず、状態を可視化したまま維持する。",
      evidence: "sd.config.mjs の source 配列と tokens/ 配下の実ファイル一覧の差集合",
    });
  }
  return out;
}

const NODE_ID_RE = /^\d+:\d+$/;

/**
 * Counts distinct Figma node IDs under the manual figma_mirror, split by
 * whether the nearest enclosing entry carries a non-null verified_at.
 * Counts node IDs rather than entries, because one entry often lists several
 * nodes (e.g. `{default, hover, focus}` under a single verified flag).
 */
function countFigmaNodes(
  node: Json,
  inheritedVerifiedAt: Json,
  acc: { verified: Set<string>; unverified: Set<string> },
) {
  if (Array.isArray(node)) {
    for (const v of node) countFigmaNodes(v, inheritedVerifiedAt, acc);
    return;
  }
  if (typeof node === "string") {
    if (NODE_ID_RE.test(node)) {
      (inheritedVerifiedAt ? acc.verified : acc.unverified).add(node);
    }
    return;
  }
  if (!isPlainObject(node)) return;
  const verifiedAt =
    "verified_at" in node ? node["verified_at"] : inheritedVerifiedAt;
  for (const [key, v] of Object.entries(node)) {
    if (key === "verified_at" || key === "verified") continue;
    countFigmaNodes(v, verifiedAt, acc);
  }
}

// ---------------------------------------------------------------------------
// Kit assembly
// ---------------------------------------------------------------------------

export interface BuildResult {
  kit: JsonObject;
  collisions: string[];
  manualMissingVerifiedAt: string[];
}

export function buildKit(opts: { volatile: boolean }): BuildResult {
  const base = readJson(resolve(ROOT, "tokens/base.json"));
  const cjk = readJson(resolve(ROOT, "tokens/overrides/cjk.json"));
  const manual = readJson(MANUAL_PATH);

  const collisions: string[] = [];
  const ann = (manual["annotations"] as JsonObject | undefined) ?? {};

  const tokens = mergeAnnotations(
    buildTokens(base, cjk),
    ann["tokens"],
    "tokens",
    collisions,
  ) as JsonObject;

  const breakpoints = mergeAnnotations(
    buildBreakpoints(base),
    ann["breakpoints"],
    "breakpoints",
    collisions,
  ) as JsonObject;

  const valueSot = mergeAnnotations(
    { primary: buildValueSotPrimary(opts.volatile) },
    ann["value_sot"],
    "value_sot",
    collisions,
  ) as JsonObject;

  // components: code side is derived, Figma side is manual.
  const uiComponents = listUiComponents();
  const componentsCode: JsonObject = {
    code_sot: {
      path: relative(ROOT, UI_DIR),
      count_tsx: uiComponents.length,
      list: uiComponents,
      button_variants: {
        _source: "components/ui/button.tsx の cva",
        variant: readCvaKeys("button.tsx", "variant"),
        size: readCvaKeys("button.tsx", "size"),
      },
      badge_variants: {
        _source: "components/ui/badge.tsx の cva",
        variant: readCvaKeys("badge.tsx", "variant"),
      },
    },
  };
  const components = mergeAnnotations(
    componentsCode,
    manual["components"],
    "components",
    collisions,
  ) as JsonObject;

  const manualConflicts = (manual["conflicts"] as JsonObject[] | undefined) ?? [];
  const conflicts = [...buildAutoConflicts(), ...manualConflicts];

  const knownGaps = (manual["known_gaps"] as JsonObject[] | undefined) ?? [];
  const nonNegotiables =
    (manual["non_negotiables"] as JsonObject[] | undefined) ?? [];
  const acceptedNp = (manual["accepted_np"] as JsonObject | undefined) ?? {};

  // verified_at enforcement: every manual entry must carry one.
  const manualMissingVerifiedAt: string[] = [];
  const requireVerifiedAt = (arr: JsonObject[], label: string) => {
    arr.forEach((entry, i) => {
      if (!("verified_at" in entry)) {
        manualMissingVerifiedAt.push(`${label}[${i}] (id=${entry["id"] ?? "?"})`);
      }
    });
  };
  requireVerifiedAt(manualConflicts, "conflicts");
  requireVerifiedAt(knownGaps, "known_gaps");
  requireVerifiedAt(nonNegotiables, "non_negotiables");
  for (const [key, value] of Object.entries(acceptedNp)) {
    if (key.startsWith("_")) continue;
    if (isPlainObject(value) && !("verified_at" in value)) {
      manualMissingVerifiedAt.push(`accepted_np.${key}`);
    }
  }

  const figmaNodes = {
    verified: new Set<string>(),
    unverified: new Set<string>(),
  };
  countFigmaNodes(components["figma_mirror"], null, figmaNodes);

  const severity: Record<string, number> = {};
  for (const c of conflicts) {
    const s = String(c["severity"] ?? "UNKNOWN");
    severity[s] = (severity[s] ?? 0) + 1;
  }

  const kit: JsonObject = {
    $schema_version: manual["$schema_version"] ?? "1.0",
    file_identity: manual["file_identity"] ?? {},
    project: manual["project"] ?? {},
    media_profile: manual["media_profile"] ?? [],
    generated_at: opts.volatile
      ? new Date().toISOString()
      : VOLATILE_PLACEHOLDER,
    generator: {
      ...(manual["generator"] as JsonObject),
      method:
        "scripts/design-system/generate-design-kit.ts による機械生成。tokens / value_sot / breakpoints.code_* / counts / conflicts(自動検出分) はコード実読から導出。Figma node ID 等コードから導けない項目のみ scripts/design-system/design-kit.manual.json で手動保守し、各エントリは verified_at (最終確認日) を必須とする。",
      script: "scripts/design-system/generate-design-kit.ts",
      manual_input: "scripts/design-system/design-kit.manual.json",
      drift_guard:
        "pnpm validate:design-kit (CI static-checks)。再生成結果と scripts/design-system/design-kit.generated.json に差分があれば exit 1。",
    },
    value_sot: valueSot,
    tokens,
    breakpoints,
    components,
    non_negotiables: nonNegotiables,
    accepted_np: acceptedNp,
    conflicts,
    known_gaps: knownGaps,
    spec_refs: manual["spec_refs"] ?? {},
    counts: {
      _method: "generate-design-kit.ts による実カウント (手計算なし)",
      conflicts: conflicts.length,
      conflicts_by_severity: severity,
      conflicts_auto_detected: buildAutoConflicts().length,
      conflicts_manual: manualConflicts.length,
      known_gaps: knownGaps.length,
      known_gaps_open: knownGaps.filter(
        (g) => !String(g["status"] ?? "").startsWith("RESOLVED"),
      ).length,
      known_gaps_resolved: knownGaps.filter((g) =>
        String(g["status"] ?? "").startsWith("RESOLVED"),
      ).length,
      non_negotiables: nonNegotiables.length,
      accepted_np: Object.keys(acceptedNp).filter((k) => !k.startsWith("_"))
        .length,
      _figma_node_count_method:
        "components.figma_mirror 配下に現れる distinct な Figma node ID (\\d+:\\d+) を、直近の verified_at の有無で分類した実カウント。",
      figma_nodes_verified: figmaNodes.verified.size,
      figma_nodes_unverified: figmaNodes.unverified.size,
      code_ui_components: uiComponents.length,
    },
  };

  return { kit, collisions, manualMissingVerifiedAt };
}

export function serialize(kit: JsonObject): string {
  return `${JSON.stringify(kit, null, 2)}\n`;
}

/** Flat path-keyed view, for readable diffs. */
export function flatten(node: Json, path = "", out: Map<string, string> = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, path ? `${path}.${k}` : k, out);
    }
  } else {
    out.set(path, JSON.stringify(node));
  }
  return out;
}
