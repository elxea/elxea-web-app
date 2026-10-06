import { describe, it, expect } from "vitest";

import {
  measure,
  isWrapper,
  isUndecorated,
  extractRoute,
  measureFrozenSections,
} from "@/scripts/design-system/figma-ds-instance-rate";
import { loadFrozenSections } from "@/scripts/design-system/figma-snapshot-lib";

/**
 * wrapper 除外ルールの fixture 単体テスト。
 *
 * ルール (監査提案 / Boss 承認済 2026-07-13):
 *   INSTANCE を直下に内包する無装飾 (fill/stroke/effect なし) の FRAME/GROUP は
 *   素描き母集団 (total = 分母) から除外し、件数を wrapper_excluded に別掲する。
 *   除外しても子孫 (内包 INSTANCE 等) には通常どおり降下する。
 *
 * Figma token が .env.local 未設定のため実 API は叩かず、node ツリーの fixture で
 * measure() の決定論を検証する (real API run は token 設定後に detector が実行)。
 */

type N = {
  id: string;
  name: string;
  type: string;
  children?: N[];
  fills?: Array<{ visible?: boolean }>;
  strokes?: Array<{ visible?: boolean }>;
  effects?: Array<{ visible?: boolean }>;
};

const instance = (id: string): N => ({ id, name: id, type: "INSTANCE" });
const solidFill = [{ visible: true }];

describe("figma-ds-instance-rate: wrapper 除外ルール", () => {
  it("baseline: INSTANCE と非 INSTANCE ノードを従来どおり数える", () => {
    // section > [ TEXT, INSTANCE ]  (TEXT は装飾 FRAME ではないので wrapper ではない)
    const section: N = {
      id: "s",
      name: "@baseline",
      type: "SECTION",
      children: [
        { id: "t", name: "title", type: "TEXT" },
        instance("btn"),
      ],
    };
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 2,
      wrapper_excluded: 0,
    });
  });

  it("無装飾 FRAME が INSTANCE を直下に内包する → wrapper として total から除外", () => {
    // section > wrapperFrame(無装飾) > INSTANCE
    const section: N = {
      id: "s",
      name: "@wrap",
      type: "SECTION",
      children: [
        {
          id: "w",
          name: "wrapper",
          type: "FRAME",
          fills: [],
          strokes: [],
          effects: [],
          children: [instance("btn")],
        },
      ],
    };
    // wrapper は total に数えない (0) が、内包 INSTANCE は降下して 1 カウント
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 1,
      wrapper_excluded: 1,
    });
  });

  it("装飾あり FRAME (可視 fill) が INSTANCE を内包 → wrapper ではない (total に残る)", () => {
    const section: N = {
      id: "s",
      name: "@decorated",
      type: "SECTION",
      children: [
        {
          id: "card",
          name: "card",
          type: "FRAME",
          fills: solidFill,
          children: [instance("btn")],
        },
      ],
    };
    // card は装飾ありなので分母に残る (1) + INSTANCE (1) = total 2
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 2,
      wrapper_excluded: 0,
    });
  });

  it("GROUP は純コンテナ (無装飾) → INSTANCE 内包で wrapper 除外", () => {
    const section: N = {
      id: "s",
      name: "@group",
      type: "SECTION",
      children: [
        {
          id: "g",
          name: "group",
          type: "GROUP",
          children: [instance("a"), instance("b")],
        },
      ],
    };
    expect(measure(section as never)).toEqual({
      instances: 2,
      total: 2,
      wrapper_excluded: 1,
    });
  });

  it("無装飾 FRAME だが直下に INSTANCE を持たない → wrapper ではない", () => {
    // 直下は TEXT のみ。孫に INSTANCE があっても直下条件を満たさない。
    const section: N = {
      id: "s",
      name: "@no-direct-instance",
      type: "SECTION",
      children: [
        {
          id: "f",
          name: "frame",
          type: "FRAME",
          fills: [],
          children: [
            {
              id: "inner",
              name: "inner",
              type: "TEXT",
              children: [instance("deep")],
            },
          ],
        },
      ],
    };
    // frame(1) + inner TEXT(1) + INSTANCE(1) = total 3、除外なし
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 3,
      wrapper_excluded: 0,
    });
  });

  it("route が末尾にある実運用の命名から @/<route> を抽出できる", () => {
    expect(
      extractRoute("商品一覧 変A（部品ベース）— PC/SP @/ja/products")
    ).toBe("@/ja/products");
  });

  it("先頭 @/<route> も従来どおり抽出できる (後方互換)", () => {
    expect(extractRoute("@/ja/top hero 検証")).toBe("@/ja/top");
  });

  it("複数マッチ時は最後のものを採用する", () => {
    expect(extractRoute("旧 @/ja/old → 新 @/ja/new")).toBe("@/ja/new");
  });

  it("動的セグメント [slug] を含む route も拾える", () => {
    expect(extractRoute("記事詳細 @/ja/journal/[slug]")).toBe(
      "@/ja/journal/[slug]"
    );
  });

  it("@/<route> を含まないセクション名は null (母集団対象外)", () => {
    expect(extractRoute("表紙 Cover")).toBeNull();
    expect(extractRoute("メール @ mention だけ")).toBeNull();
  });

  it("invisible な fill のみ持つ FRAME は無装飾扱い", () => {
    expect(
      isUndecorated({
        id: "x",
        name: "x",
        type: "FRAME",
        fills: [{ visible: false }] as never,
      } as never)
    ).toBe(true);
    expect(
      isWrapper({
        id: "x",
        name: "x",
        type: "FRAME",
        fills: [{ visible: false }] as never,
        children: [instance("i") as never],
      } as never)
    ).toBe(true);
  });
});

/**
 * 区画の引き方 (2026-10-06): 母集団は frozen-sections.json の凍結区画。
 * 選択 (selectFrozenSections) は figma-snapshot.test.ts で検証済みのため、ここでは
 * 「選ばれた区画 → 区画ごとの率 / route 合算 / 全体の率」の決定論を検証する。
 */
describe("figma-ds-instance-rate: 凍結区画からの計測 (measureFrozenSections)", () => {
  const mapping = [
    { section_id: "1:1", title: "トップ", route: "@/ja" },
    { section_id: "2:1", title: "イベント詳細", route: "@/ja/events/[slug]" },
    { section_id: "2:2", title: "イベント申込", route: "@/ja/events/[slug]" },
  ];
  const sec = (id: string, children: N[]): N => ({ id, name: id, type: "SECTION", children });
  const text = (id: string): N => ({ id, name: id, type: "TEXT" });
  const docs = {
    // 1 instance / 2 total
    "1:1": sec("1:1", [instance("a"), text("t1")]),
    // 2 instance / 2 total
    "2:1": sec("2:1", [instance("b"), instance("c")]),
    // 1 instance / 4 total
    "2:2": sec("2:2", [instance("d"), text("t2"), text("t3"), text("t4")]),
  };
  const fetched = {
    routeSections: [
      { id: "2:2", route: "@/ja/events/[slug]" },
      { id: "1:1", route: "@/ja" },
      { id: "2:1", route: "@/ja/events/[slug]" },
    ],
    sectionDocs: docs as never,
  };

  it("区画ごとの率を出し、title は frozen-sections.json から引く", () => {
    const { sections } = measureFrozenSections(fetched, mapping);
    expect(sections.map((s) => [s.section_id, s.title, s.instances, s.total, s.rate])).toEqual([
      ["1:1", "トップ", 1, 2, 0.5],
      ["2:1", "イベント詳細", 2, 2, 1],
      ["2:2", "イベント申込", 1, 4, 0.25],
    ]);
  });

  it("同じ route の区画は routes[] で合算する (baseline のキー = route 名が重複しない)", () => {
    const { routes } = measureFrozenSections(fetched, mapping);
    expect(routes.map((r) => r.name)).toEqual(["@/ja", "@/ja/events/[slug]"]);
    const ev = routes[1];
    expect([ev.instances, ev.total, ev.rate]).toEqual([3, 6, 0.5]);
    expect(ev.section_ids).toEqual(["2:1", "2:2"]);
    expect(ev.node_id).toBe("2:1,2:2");
    // drift-audit-design.sh が読む欄
    for (const r of routes) {
      expect(Object.keys(r)).toEqual(expect.arrayContaining(["name", "rate", "instances", "total"]));
    }
  });

  it("全体の率 = 全区画の合算", () => {
    const { overall } = measureFrozenSections(fetched, mapping);
    expect(overall).toEqual({ instances: 4, total: 8, rate: 0.5 });
  });

  it("document 欠落の区画は throw (穴のまま率を出さない)", () => {
    expect(() =>
      measureFrozenSections(
        { routeSections: [{ id: "9:9", route: "@/ja" }], sectionDocs: {} },
        mapping
      )
    ).toThrow(/no document/);
  });

  it("対応表に無い区画 id は throw (選択と対応表の食い違いを黙認しない)", () => {
    expect(() =>
      measureFrozenSections(
        { routeSections: [{ id: "9:9", route: "@/ja" }], sectionDocs: { "9:9": sec("9:9", []) } as never },
        mapping
      )
    ).toThrow(/not in frozen-sections.json/);
  });

  it("実物の frozen-sections.json を読め、合算後の route 数は区画数を超えない", () => {
    const real = loadFrozenSections();
    const routes = new Set(real.map((m) => m.route));
    expect(real.length).toBeGreaterThan(0);
    expect(routes.size).toBeLessThanOrEqual(real.length);
  });
});
