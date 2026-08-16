import { describe, expect, it } from "vitest";

import {
  aromaFieldFor,
  aromaSamplesByCategory,
} from "@/lib/roji/tea-aroma";
import {
  DEFAULT_TEA_CATEGORY,
  TEA_CATEGORY_COLOR,
  TEA_CATEGORY_ORDER,
  normalizeTeaCategory,
  teaCategoryFromMenuNumber,
  teaCategoryLabel,
  teaCategoryOf,
} from "@/lib/roji/tea-category";
import {
  flavorMatrixFor,
  flavorSamplesByCategory,
} from "@/lib/roji/tea-flavor";
import { terroirOverviewFor } from "@/lib/roji/tea-terroir-overview";

/**
 * roji データ表現の **恒久ルール** を固定するテスト。
 *
 * ルール (全文 `docs/roji-dataviz-rules.md`・Setaka 指摘 4 回・2026-08-17 確定):
 *   1. 比較対象は「いま見ているお茶と同じカテゴリー」だけ
 *   2. 図の色はお茶のカテゴリーを表す → 1 枚に載る点は必ず全て同色
 *
 * ここが落ちたら **図の見た目の問題ではなく、載せる対象を誤っている**。
 * 通すために期待値を緩めない — 直すのは実装側である。
 */

/** 五桁採番の代表例。先頭 1 桁が六大茶類 (`lib/roji/tea-origins.ts` の対応表)。 */
const GREEN_NUMBER = "10101";
const BLUE_NUMBER = "40101";
const BLACK_NUMBER = "50101";

describe("恒久ルール 1: 比較対象は同カテゴリーのみ", () => {
  it("味の四象限に他カテゴリーの銘柄が 1 件も混ざらない", () => {
    for (const menuNumber of [GREEN_NUMBER, BLUE_NUMBER, BLACK_NUMBER]) {
      const data = flavorMatrixFor(menuNumber);
      expect(data.points.length).toBeGreaterThan(0);
      for (const point of data.points) {
        expect(point.category).toBe(data.category);
      }
    }
  });

  it("香りの場に他カテゴリーの香りが 1 件も混ざらない", () => {
    for (const menuNumber of [GREEN_NUMBER, BLUE_NUMBER, BLACK_NUMBER]) {
      const data = aromaFieldFor(menuNumber);
      expect(data.notes.length).toBeGreaterThan(0);
      for (const note of data.notes) {
        expect(note.category).toBe(data.category);
      }
    }
  });

  it("緑茶を見ているとき、紅茶の銘柄は出ない (差し戻しの原因そのもの)", () => {
    const green = flavorMatrixFor(GREEN_NUMBER);
    const black = flavorMatrixFor(BLACK_NUMBER);
    expect(green.category).toBe("green");
    expect(black.category).toBe("black");

    const greenIds = new Set(green.points.map((p) => p.id));
    for (const point of black.points) {
      expect(greenIds.has(point.id)).toBe(false);
    }
  });

  it("ダミーの束そのものが混ざっていない (差し替え時の契約)", () => {
    const flavor = flavorSamplesByCategory();
    const aroma = aromaSamplesByCategory();
    for (const category of TEA_CATEGORY_ORDER) {
      expect(flavor[category].length).toBeGreaterThan(0);
      expect(aroma[category].length).toBeGreaterThan(0);
      for (const point of flavor[category]) expect(point.category).toBe(category);
      for (const note of aroma[category]) expect(note.category).toBe(category);
    }
  });

  it("強調される銘柄は必ず同カテゴリーの集合の中にある", () => {
    for (const menuNumber of [GREEN_NUMBER, BLUE_NUMBER, BLACK_NUMBER, "99999", "7"]) {
      const data = flavorMatrixFor(menuNumber);
      expect(data.points.some((p) => p.id === data.highlightId)).toBe(true);
    }
  });

  it("カテゴリー不明でも全件とは並べない (どれか 1 つに寄せる)", () => {
    const data = flavorMatrixFor("ELX-2026-04", "まだ決めていない");
    expect(data.category).toBe(DEFAULT_TEA_CATEGORY);
    for (const point of data.points) expect(point.category).toBe(DEFAULT_TEA_CATEGORY);
    // 全カテゴリーの合計より必ず少ない = 「不明だから全部見せる」になっていない
    const all = Object.values(flavorSamplesByCategory()).reduce(
      (sum, list) => sum + list.length,
      0
    );
    expect(data.points.length).toBeLessThan(all);
  });
});

describe("恒久ルール 2: 図の色はカテゴリー (1 枚は単色)", () => {
  it("味の四象限が使う色は 1 色に定まる", () => {
    for (const menuNumber of [GREEN_NUMBER, BLUE_NUMBER, BLACK_NUMBER]) {
      const data = flavorMatrixFor(menuNumber);
      const colors = new Set(data.points.map((p) => TEA_CATEGORY_COLOR[p.category]));
      expect(colors.size).toBe(1);
      expect([...colors][0]).toBe(TEA_CATEGORY_COLOR[data.category]);
    }
  });

  it("香りの場が使う色も 1 色に定まる (系統では色を変えない)", () => {
    for (const menuNumber of [GREEN_NUMBER, BLUE_NUMBER, BLACK_NUMBER]) {
      const data = aromaFieldFor(menuNumber);
      const colors = new Set(data.notes.map((n) => TEA_CATEGORY_COLOR[n.category]));
      expect(colors.size).toBe(1);
    }
  });

  it("カテゴリーごとに色が重複しない (地図で 2 カテゴリーが同色にならない)", () => {
    const colors = TEA_CATEGORY_ORDER.map((c) => TEA_CATEGORY_COLOR[c]);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("カテゴリーの判定", () => {
  it("銘柄番号 5 桁の先頭 1 桁が六大茶類になる", () => {
    expect(teaCategoryFromMenuNumber("10101")).toBe("green");
    expect(teaCategoryFromMenuNumber("40101")).toBe("blue");
    expect(teaCategoryFromMenuNumber("50101")).toBe("black");
  });

  it("5 桁でない番号は判定しない (推測しない)", () => {
    expect(teaCategoryFromMenuNumber(1)).toBeNull();
    expect(teaCategoryFromMenuNumber("ELX-2026-04")).toBeNull();
    expect(teaCategoryFromMenuNumber(null)).toBeNull();
  });

  it("Sanity の自由記述を六大茶類へ畳む", () => {
    expect(normalizeTeaCategory("sencha")).toBe("green");
    expect(normalizeTeaCategory("煎茶")).toBe("green");
    expect(normalizeTeaCategory("gyokuro")).toBe("green");
    expect(normalizeTeaCategory("ほうじ茶")).toBe("green");
    expect(normalizeTeaCategory("和紅茶")).toBe("black");
    expect(normalizeTeaCategory("ウーロン茶")).toBe("blue");
    expect(normalizeTeaCategory("プーアル茶")).toBe("dark");
    expect(normalizeTeaCategory("知らない語")).toBeNull();
    expect(normalizeTeaCategory("")).toBeNull();
  });

  it("番号が優先され、番号が使えないときだけ自由記述に落ちる", () => {
    // 番号 (青茶) と自由記述 (煎茶 = 緑茶) が食い違う場合、構造化された番号を採る
    expect(teaCategoryOf("40101", "煎茶")).toBe("blue");
    expect(teaCategoryOf("ELX-2026-04", "煎茶")).toBe("green");
    expect(teaCategoryOf(null, "和紅茶")).toBe("black");
    expect(teaCategoryOf(null, null)).toBe(DEFAULT_TEA_CATEGORY);
  });

  it("図の外に出す名前は locale で変わる", () => {
    expect(teaCategoryLabel("green", "ja")).toBe("緑茶");
    expect(teaCategoryLabel("green", "en")).toBe("green tea");
  });
});

describe("一覧のテロワール地図", () => {
  /** 5 桁採番の実データ (静岡 / 奈良 / 福岡)。 */
  const ITEMS = [
    { id: "a", menuNumber: "10101", category: "sencha" }, // 静岡県静岡市
    { id: "b", menuNumber: "11301", category: "sencha" }, // 奈良県山添村
    { id: "c", menuNumber: "11601", category: "sencha" }, // 福岡県八女市
  ];

  it("表示中の産地が全部収まる矩形になる", () => {
    const data = terroirOverviewFor(ITEMS);
    expect(data).not.toBeNull();
    for (const pin of data!.pins) {
      expect(pin.lng).toBeGreaterThanOrEqual(data!.bounds.west);
      expect(pin.lng).toBeLessThanOrEqual(data!.bounds.east);
      expect(pin.lat).toBeGreaterThanOrEqual(data!.bounds.south);
      expect(pin.lat).toBeLessThanOrEqual(data!.bounds.north);
    }
  });

  it("表示が減れば尺度も縮む (フィルタに追従する)", () => {
    const wide = terroirOverviewFor(ITEMS)!;
    const narrow = terroirOverviewFor(ITEMS.slice(0, 1))!;
    const spanOf = (b: { west: number; east: number }) => b.east - b.west;
    expect(spanOf(narrow.bounds)).toBeLessThan(spanOf(wide.bounds));
  });

  it("1 点だけでも最大ズームまで寄らない広がりを持つ", () => {
    const one = terroirOverviewFor(ITEMS.slice(0, 1))!;
    expect(one.bounds.east - one.bounds.west).toBeGreaterThan(0.5);
    expect(one.bounds.north - one.bounds.south).toBeGreaterThan(0.3);
  });

  it("自由記述の産地からは都道府県までしか降りない (座標を推測しない)", () => {
    const data = terroirOverviewFor([
      { id: "x", menuNumber: 1, origin: "静岡県牧之原市", category: "sencha" },
    ])!;
    expect(data.pins).toHaveLength(1);
    expect(data.pins[0].precision).toBe("prefecture");
    expect(data.pins[0].place).toBe("静岡県");
  });

  it("座標の当てが無い産地は地図に出さない (適当な点で埋めない)", () => {
    // 石川県には仕入先が 1 軒も無い = 代表点が存在しない
    expect(
      terroirOverviewFor([
        { id: "y", menuNumber: 3, origin: "石川県加賀市", category: "hojicha" },
      ])
    ).toBeNull();
  });

  it("カテゴリーで絞り込めば地図も単色になる", () => {
    const mixed = terroirOverviewFor([
      ...ITEMS,
      { id: "d", menuNumber: "50101", category: "紅茶" },
    ])!;
    expect(mixed.categories.length).toBe(2);

    const filtered = terroirOverviewFor(ITEMS)!;
    expect(filtered.categories).toEqual(["green"]);
  });
});
