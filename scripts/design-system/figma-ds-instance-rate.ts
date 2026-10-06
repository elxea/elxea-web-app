/**
 * figma-ds-instance-rate.ts
 *
 * デザイン・ドリフト週次検査① (design-drift-weekly / drift-audit-runner check#19):
 * 凍結レイアウト区画 (frozen-sections.json に載る section) ごとに DS インスタンス化率を
 * 決定論的に計測して JSON 出力する (計測のみ。合否判定・baseline 管理は
 * ~/.config/admin-pipeline/scripts/drift-audit-design.sh 側の責務)。
 *
 * 母集団 (2026-10-06 更新): 忠実度チェック (figma-snapshot) と同じく、
 * 「<領域> / Layouts」ページ直下の凍結 section を frozen-sections.json (section_id → route)
 * で引く。区画の選び方は figma-snapshot-lib.ts の fetchProposalSections /
 * selectFrozenSections を共用し、同じ Figma の「正本として見る区画」を 1 か所にする。
 * (旧: 名前に "Proposals" を含むページが 1 枚だけある前提。Figma のページ分割
 *  「CX / Proposals」「EC / Proposals」等で 2026-09-08 から found 11 で失敗していた。)
 *
 * Metric (決定論・安定):
 *   各区画配下を走査し、
 *     - INSTANCE ノード = DS コンポーネント由来としてカウントし、内部には降下しない
 *       (インスタンス内部は DS 提供物であり手描き分母に含めない)
 *     - それ以外の全ノード = 手描き候補として分母にカウントし降下する
 *   rate = instances / total (total = instances + non-instance nodes)
 *
 * 出力:
 *   routes[]   : route 単位 (drift-audit-design.sh が name/rate/instances/total で baseline 比較)。
 *                同じ route を複数区画が持つとき (例 イベント詳細/申込/申込完了) は合算する。
 *   sections[] : 区画ごとの率 (参考)。
 *   summary.overall : 全区画合算の率。
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
 * Exit codes: 0=計測成功 / 1=致命 (token/API/Layouts ページ不在/対応表の stale/母集団ゼロ)。
 */

import { pathToFileURL } from "node:url";

import {
  fetchProposalSections,
  loadFrozenSections,
  loadToken,
  FROZEN_SECTIONS_PATH,
  type FigmaNode,
  type FigmaPaint,
  type FigmaEffect,
  type FrozenSectionEntry,
  type ProposalFetch,
} from "./figma-snapshot-lib";

// 旧 API の互換 (route 抽出の実装は figma-snapshot-lib.ts に一本化)
export { extractRoute } from "./figma-snapshot-lib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionMeasurement {
  section_id: string;
  title: string;
  route: string;
  node_type: string;
  instances: number;
  total: number;
  rate: number;
  wrapper_excluded: number;
}

export interface RouteMeasurement {
  name: string;
  /** 区画 id (複数区画を合算した route は "," 区切り)。 */
  node_id: string;
  node_type: string;
  section_ids: string[];
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

function toRate(instances: number, total: number): number {
  return total > 0 ? Math.round((instances / total) * 10000) / 10000 : 0;
}

// ---------------------------------------------------------------------------
// 区画 → route の計測 (純関数・テスト対象)
// ---------------------------------------------------------------------------

/**
 * fetchProposalSections が選んだ区画 (frozen-sections.json 由来) を区画ごとに計測し、
 * route 単位に合算する。
 * - title は frozen-sections.json から引く (対応表に無い id は throw: 選択と対応表の食い違い)。
 * - 区画の document 欠落は throw (穴のまま率を出さない)。
 * - routes は name 昇順、sections は route → section_id 昇順 (決定論)。
 */
export function measureFrozenSections(
  fetched: Pick<ProposalFetch, "routeSections" | "sectionDocs">,
  mapping: FrozenSectionEntry[]
): {
  sections: SectionMeasurement[];
  routes: RouteMeasurement[];
  overall: { instances: number; total: number; rate: number };
} {
  const titleById = new Map(mapping.map((m) => [m.section_id, m.title]));
  const sections: SectionMeasurement[] = fetched.routeSections.map((s) => {
    const doc = fetched.sectionDocs[s.id];
    if (!doc) {
      throw new Error(`no document for frozen section id=${s.id} (refusing to measure a hole)`);
    }
    const title = titleById.get(s.id);
    if (title === undefined) {
      throw new Error(`section id=${s.id} is not in frozen-sections.json (selection/mapping mismatch)`);
    }
    const { instances, total, wrapper_excluded } = measure(doc);
    return {
      section_id: s.id,
      title,
      route: s.route,
      node_type: doc.type,
      instances,
      total,
      rate: toRate(instances, total),
      wrapper_excluded,
    };
  });
  sections.sort((a, b) =>
    a.route < b.route ? -1 : a.route > b.route ? 1 : a.section_id < b.section_id ? -1 : 1
  );

  const byRoute = new Map<string, SectionMeasurement[]>();
  for (const s of sections) {
    const list = byRoute.get(s.route) ?? [];
    list.push(s);
    byRoute.set(s.route, list);
  }
  const routes: RouteMeasurement[] = [...byRoute.entries()].map(([name, list]) => {
    const instances = list.reduce((acc, s) => acc + s.instances, 0);
    const total = list.reduce((acc, s) => acc + s.total, 0);
    return {
      name,
      node_id: list.map((s) => s.section_id).join(","),
      node_type: [...new Set(list.map((s) => s.node_type))].join(","),
      section_ids: list.map((s) => s.section_id),
      instances,
      total,
      rate: toRate(instances, total),
      wrapper_excluded: list.reduce((acc, s) => acc + s.wrapper_excluded, 0),
    };
  });
  routes.sort((a, b) => a.name.localeCompare(b.name));

  const instances = sections.reduce((acc, s) => acc + s.instances, 0);
  const total = sections.reduce((acc, s) => acc + s.total, 0);
  return { sections, routes, overall: { instances, total, rate: toRate(instances, total) } };
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
  const mapping = loadFrozenSections();

  // 区画の選び方は忠実度チェック (figma-snapshot) と共用 (fail-loud は lib 側が throw)
  const fetched = await fetchProposalSections(fileKey, token, mapping);
  const { sections, routes, overall } = measureFrozenSections(fetched, mapping);

  const report = {
    tool: "figma-ds-instance-rate",
    metric:
      "instances / total; INSTANCE は内部非降下で 1 カウント、非 INSTANCE 全ノードが分母",
    population:
      "frozen-sections.json の凍結区画 (<領域> / Layouts ページ直下)。同じ route の区画は routes[] で合算",
    mapping_path: FROZEN_SECTIONS_PATH.replace(`${process.cwd()}/`, ""),
    file_key: fileKey,
    file_name: fetched.fileName,
    last_modified: fetched.fileLastModified,
    pages: fetched.pages,
    measured_at: new Date().toISOString(),
    routes,
    sections,
    excluded: {
      sections_without_route: fetched.sectionsWithoutRoute,
    },
    summary: {
      route_count: routes.length,
      section_count: sections.length,
      excluded_section_count: fetched.sectionsWithoutRoute.length,
      min_rate: Math.min(...routes.map((r) => r.rate)),
      max_rate: Math.max(...routes.map((r) => r.rate)),
      overall,
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
  console.log(
    `DS instance rate — ${report.file_name} / ${sections.length} frozen sections (${routes.length} routes)`
  );
  for (const r of routes) {
    const wrap = r.wrapper_excluded > 0 ? ` [wrapper-excluded: ${r.wrapper_excluded}]` : "";
    const n = r.section_ids.length > 1 ? ` [${r.section_ids.length} sections]` : "";
    console.log(
      `  ${r.name}: ${(r.rate * 100).toFixed(1)}% (${r.instances}/${r.total})${n}${wrap}`
    );
  }
  console.log(
    `  overall: ${(overall.rate * 100).toFixed(1)}% (${overall.instances}/${overall.total})`
  );
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
