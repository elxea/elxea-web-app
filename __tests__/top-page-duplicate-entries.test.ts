/**
 * トップページの「同じ行き先の入口が多い」を、数えられる形で縛る (監査 #18)。
 *
 * ## 実測 (2026-08-26 / 本番 https://elxea.com/ja / SP390)
 *
 * `a[href]` を href ごとに数えると、重複していたのは次の 2 種類だった:
 *
 *   1. **同じ行き先・同じ名前が 3 本** — `/ja/products` へ「茶葉の一覧へ」が
 *      ヒーロー・導線ブロック・最下部の購入導線から出ていた。リンクの一覧を
 *      読み上げると同じ文字が 3 回並び、どれが何なのか区別できない。
 *   2. **名前と行き先が食い違うタイルが 1 本** — CATEGORIES に「イベント」という
 *      名前のタイルがあり、着地先は `/ja/products?category=イベント`
 *      (= 商品一覧)。監査が数えた「イベント導線 4 本」の 4 本目がこれで、
 *      他の 3 本 (ヘッダー / 導線ブロック / フッター) とは行き先が違う。
 *
 * 節そのものは Figma で凍結済み (2026-08-08 見た目一括承認) なので**消さない**。
 * 直すのは「名前が同じで区別できない」「名前と行き先が食い違う」の 2 点だけ。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { excludeReservedTitles } from "@/lib/navigation/reserved-destinations";

const ja = JSON.parse(
  readFileSync(join(process.cwd(), "messages/ja.json"), "utf8"),
) as { homeR2: Record<string, string>; common: Record<string, string> };

describe("同じ行き先の入口に、同じ名前を付けない", () => {
  it("商品一覧へ向かう 3 本の名前がすべて違う", () => {
    const labels = [
      ja.homeR2.heroCta, // ヒーローの CTA
      ja.homeR2.guideTeaLink, // 導線ブロックの TEA タイル
      ja.homeR2.purchaseLink, // 最下部の購入導線
    ];

    /* 矢印や前後の空白は読み上げに出ないことがあるので、落としてから比べる。
       「→ が付いているかどうかだけが違う」は区別になっていない。 */
    const spoken = labels.map((label) => label.replace(/[→\s]/g, ""));
    expect(new Set(spoken).size).toBe(spoken.length);
  });
});

describe("主要な行き先と同じ名前のタイルを出さない", () => {
  const collections = [
    { title: "緑茶" },
    { title: "紅茶" },
    { title: "イベント" }, // ← 名前はイベント、行き先は商品一覧
    { title: "お茶のアソートセット" },
  ];

  it("「イベント」という名前のコレクションはカテゴリータイルにしない", () => {
    const kept = excludeReservedTitles(collections, [ja.common.events]);
    expect(kept.map((c) => c.title)).toEqual([
      "緑茶",
      "紅茶",
      "お茶のアソートセット",
    ]);
  });

  it("主要な行き先の名前を増やせば、その名前も落ちる (名前を焼かない)", () => {
    const kept = excludeReservedTitles(collections, [
      ja.common.events,
      ja.common.journal,
      ja.common.teaMenu,
      ja.common.subscription,
    ]);
    expect(kept.map((c) => c.title)).not.toContain("イベント");
  });

  it("全角/半角・大文字小文字・前後の空白の違いでは取り逃さない", () => {
    const kept = excludeReservedTitles(
      [{ title: " ｉｖｅｎｔ " }, { title: "緑茶" }],
      ["Ivent"],
    );
    expect(kept.map((c) => c.title)).toEqual(["緑茶"]);
  });

  it("関係の無い名前は落とさない", () => {
    const kept = excludeReservedTitles(collections, ["存在しない行き先"]);
    expect(kept).toHaveLength(collections.length);
  });

  it("空文字の予約名では何も落とさない (全部消える事故を作らない)", () => {
    const kept = excludeReservedTitles([{ title: "" }, { title: "緑茶" }], ["", "   "]);
    expect(kept).toHaveLength(2);
  });
});
