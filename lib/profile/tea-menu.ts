/**
 * お茶の銘柄座標 (実データ)。
 *
 * `lib/roji/tea-flavor.ts` / `lib/roji/tea-aroma.ts` の現行座標はすべてダミー
 * (両ファイル冒頭に明記)。roji プロファイル (ミクロ⇔マクロ) の実データ層は
 * それらを使わず、Notion Tea Menu List から生成したこの表を新しく持つ
 * (Spec §「銘柄座標は『無いものを作らない』」・実測 2026-09-05)。
 *
 * `flavor` (味わい) / `aroma` (香り) は 1〜5 の整数そのまま (情報を増やさない)。
 * 座標 (`point`) は `lib/profile/axes.ts#mapTeaAxes` を経由するので、写像 A/B の
 * 切替はこの表を触らずに済む。
 *
 * `label` は Menu No. をそのまま使う暫定値。実銘柄名 (Notion の Name) との結合は
 * 段2以降 (本 PR の範囲外)。
 *
 * 座標を持たない銘柄 (販売中30件中6件) は載せない (2026-08-14 Setaka指示
 * 「空っぽのやつは一旦、表示しなくていい」を継承)。
 */

import { mapTeaAxes, type AxisPoint } from "@/lib/profile/axes";
import type { TeaCategory } from "@/lib/profile/contract";

export interface TeaMenuEntry {
  /** Notion Tea Menu List の Menu No.。 */
  teaId: string;
  label: string;
  category: TeaCategory;
  flavor: number;
  aroma: number;
  point: AxisPoint;
}

interface RawTeaMenuRow {
  menuNo: string;
  category: TeaCategory;
  flavor: number;
  aroma: number;
}

/** 実測 2026-09-05 (Notion Tea Menu List API クエリで再取得・24件全件)。 */
const RAW_ROWS: readonly RawTeaMenuRow[] = [
  // 紅茶 (red) — 8件
  { menuNo: "50901", category: "red", flavor: 2, aroma: 3 },
  { menuNo: "51301", category: "red", flavor: 2, aroma: 3 },
  { menuNo: "51001", category: "red", flavor: 2, aroma: 4 },
  { menuNo: "50301", category: "red", flavor: 3, aroma: 4 },
  { menuNo: "50101", category: "red", flavor: 4, aroma: 4 },
  { menuNo: "50201", category: "red", flavor: 4, aroma: 4 },
  { menuNo: "50401", category: "red", flavor: 4, aroma: 5 },
  { menuNo: "50501", category: "red", flavor: 5, aroma: 4 },
  // 緑茶 (green) — 10件
  { menuNo: "10401", category: "green", flavor: 1, aroma: 2 },
  { menuNo: "10501", category: "green", flavor: 1, aroma: 3 },
  { menuNo: "10101", category: "green", flavor: 1, aroma: 4 },
  { menuNo: "10601", category: "green", flavor: 2, aroma: 3 },
  { menuNo: "10901", category: "green", flavor: 2, aroma: 4 },
  { menuNo: "10701", category: "green", flavor: 3, aroma: 2 },
  { menuNo: "10201", category: "green", flavor: 3, aroma: 3 },
  { menuNo: "11501", category: "green", flavor: 3, aroma: 4 },
  { menuNo: "10801", category: "green", flavor: 4, aroma: 3 },
  { menuNo: "11601", category: "green", flavor: 4, aroma: 4 },
  // 青茶 (oolong) — 6件
  { menuNo: "40501", category: "oolong", flavor: 1, aroma: 2 },
  { menuNo: "40301", category: "oolong", flavor: 1, aroma: 3 },
  { menuNo: "40601", category: "oolong", flavor: 1, aroma: 3 },
  { menuNo: "40201", category: "oolong", flavor: 1, aroma: 4 },
  { menuNo: "40101", category: "oolong", flavor: 2, aroma: 4 },
  { menuNo: "40401", category: "oolong", flavor: 3, aroma: 3 },
] as const;

export const TEA_MENU_TABLE: readonly TeaMenuEntry[] = RAW_ROWS.map((r) => ({
  teaId: r.menuNo,
  label: r.menuNo,
  category: r.category,
  flavor: r.flavor,
  aroma: r.aroma,
  point: mapTeaAxes(r.flavor, r.aroma),
}));

export function teaMenuForCategory(category: TeaCategory): TeaMenuEntry[] {
  return TEA_MENU_TABLE.filter((t) => t.category === category);
}
