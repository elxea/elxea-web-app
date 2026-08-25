/**
 * バリエーション選択 (サイズ / タイプ / 種類) の**速さと正しさ**の見張り。
 *
 * ## なぜこのテストが要るか
 *
 * 商品詳細で選択肢を押しても、枠が付くまで本番 SP390 実測で中央値 373ms・
 * 初回 1,187ms かかっていた (2026-08-26 / Setaka 実機指摘)。原因はテストで
 * 見える所に無かった: 選択の**正本が URL クエリ**で、`router.replace()` が
 * サーバ往復 (`?_rsc=` の再取得) を起こし、`useSearchParams()` が更新されるのは
 * サーバが商品ページを描き直して返した後だったこと。型でも単体テストでも
 * 捕まらず、**押した人にしか見えない**種類の不具合だった。
 *
 * そこで見張る所を 2 つに分ける。
 *
 * 1. **規則の正しさ** — 選択から変種を決める規則そのものを、画面と同じ 1 本
 *    (`variant-selection-state.ts`) を import して確かめる。規則を写すと、
 *    写しごと間違えたときに緑のまま本番だけ壊れる (Wave A の `cart-reducer`
 *    で実際に起きた)。
 * 2. **速さの条件** — 「押した瞬間に決まる」は、選択ボタンが
 *    ナビゲーション系 hook を触らないことで成り立っている。ここが破れると
 *    体感だけが静かに戻るので、**構造として**見張る。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applySelection,
  isOptionAvailable,
  readSelectionFromParams,
  resolveSelectedVariant,
  selectionToSearchParams,
  type ProductOption,
  type VariantSelection,
} from "@/components/product/variant-selection-state";
import type { ProductVariant } from "@/lib/shopify/types";

const REPO_ROOT = path.resolve(__dirname, "..");

const options: ProductOption[] = [
  { id: "opt-size", name: "サイズ", values: ["XS (3袋)", "S (6袋)"] },
  { id: "opt-type", name: "タイプ", values: ["フルリーフ", "ティーバッグ"] },
];

/** 4 変種。「S (6袋) x ティーバッグ」だけ売り切れにしてある。 */
function makeVariant(
  size: string,
  type: string,
  amount: string,
  availableForSale = true
): ProductVariant {
  return {
    id: `gid://shopify/ProductVariant/${size}-${type}`,
    title: `${size} / ${type}`,
    availableForSale,
    selectedOptions: [
      { name: "サイズ", value: size },
      { name: "タイプ", value: type },
    ],
    price: { amount, currencyCode: "JPY" },
    compareAtPrice: null,
    image: null,
    sellingPlanAllocations: [],
  };
}

const variants: ProductVariant[] = [
  makeVariant("XS (3袋)", "フルリーフ", "1200"),
  makeVariant("XS (3袋)", "ティーバッグ", "1300"),
  makeVariant("S (6袋)", "フルリーフ", "2200"),
  makeVariant("S (6袋)", "ティーバッグ", "2300", false),
];

describe("選択から変種を決める規則", () => {
  it("全部揃ったら、その組み合わせの変種を返す", () => {
    const selected = resolveSelectedVariant(variants, {
      サイズ: "S (6袋)",
      タイプ: "フルリーフ",
    });
    expect(selected?.price.amount).toBe("2200");
  });

  /**
   * ここが「押しても価格が変わらない」を捕まえる本体。
   *
   * 選択を 1 つ変えたら、返る変種も変わらなければならない。実装が
   * `variants[0]` を返し続ける作り (定期便 LP に実在した不具合) だと落ちる。
   */
  it("選び直すと、返る変種も変わる", () => {
    let selection: VariantSelection = { サイズ: "XS (3袋)", タイプ: "フルリーフ" };
    expect(resolveSelectedVariant(variants, selection)?.price.amount).toBe("1200");

    selection = applySelection(selection, "サイズ", "S (6袋)");
    expect(resolveSelectedVariant(variants, selection)?.price.amount).toBe("2200");

    selection = applySelection(selection, "タイプ", "ティーバッグ");
    expect(resolveSelectedVariant(variants, selection)?.price.amount).toBe("2300");
  });

  it("揃っていないときは先頭の変種に落とす (サーバの初回表示と同じ落とし方)", () => {
    expect(resolveSelectedVariant(variants, {})?.price.amount).toBe("1200");
    expect(
      resolveSelectedVariant(variants, { サイズ: "S (6袋)" })?.price.amount
    ).toBe("1200");
  });

  it("選び直しても元の選択は壊さない", () => {
    const before = { サイズ: "XS (3袋)" };
    const after = applySelection(before, "サイズ", "S (6袋)");
    expect(before).toEqual({ サイズ: "XS (3袋)" });
    expect(after).toEqual({ サイズ: "S (6袋)" });
  });
});

describe("売り切れの出し方", () => {
  it("在庫のある組み合わせが残る値は押せる", () => {
    expect(
      isOptionAvailable(options, variants, { タイプ: "フルリーフ" }, "サイズ", "S (6袋)")
    ).toBe(true);
  });

  it("その値にすると在庫が無くなる組み合わせは押せない", () => {
    expect(
      isOptionAvailable(options, variants, { サイズ: "S (6袋)" }, "タイプ", "ティーバッグ")
    ).toBe(false);
  });
});

describe("URL との行き来", () => {
  it("URL クエリから初期選択を読む", () => {
    expect(
      readSelectionFromParams(options, { サイズ: "S (6袋)", タイプ: "フルリーフ" })
    ).toEqual({ サイズ: "S (6袋)", タイプ: "フルリーフ" });
  });

  it("実在しない値は選択として拾わない", () => {
    expect(readSelectionFromParams(options, { サイズ: "XXL" })).toEqual({});
  });

  it("選択を URL クエリに写しても、無関係なクエリは消さない", () => {
    const base = new URLSearchParams("utm_source=line");
    const params = selectionToSearchParams({ サイズ: "S (6袋)" }, base);
    expect(params.get("utm_source")).toBe("line");
    expect(params.get("サイズ")).toBe("S (6袋)");
  });
});

/**
 * 速さの条件を**構造として**見張る。
 *
 * 選択ボタンが `useRouter` / `useSearchParams` / `usePathname` を使うと、
 * 押す → サーバ往復 → やっと枠が付く、に戻る。見た目は同じで体感だけ
 * 遅くなるため、目視でもスナップショットでも気づけない。
 */
describe("押した瞬間に決まる作りであること", () => {
  /**
   * 見張るのは**コード**であって説明文ではない。この 2 ファイルの注釈には
   * 「`router.replace` に戻してはいけない」と書いてあるので、注釈ごと
   * 検索すると自分の説明文で落ちる。注釈を落としてから照合する。
   */
  function readCode(relativePath: string): string {
    return readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const selectorCode = readCode("components/product/variant-selector.tsx");
  const contextCode = readCode("components/product/variant-selection-context.tsx");

  it("選択ボタンはナビゲーション系 hook を使わない", () => {
    expect(selectorCode).not.toMatch(/useRouter|useSearchParams|usePathname/);
  });

  it("選択ボタンは next/navigation を import しない", () => {
    expect(selectorCode).not.toMatch(/from\s+["']next\/navigation["']/);
  });

  /**
   * URL 同期は残すが、それは history API で行う (= サーバ往復を起こさない)。
   * `router.replace` / `router.push` に戻したらここで落とす。
   */
  it("URL 同期はサーバ往復を起こさない書き方でだけ行う", () => {
    expect(contextCode).toMatch(/history\.replaceState/);
    expect(contextCode).not.toMatch(/router\.(replace|push)/);
  });

  /** 注釈剥がしが効いていること自体の確認 (剥がし過ぎ / 剥がし漏れの検知)。 */
  it("注釈を剥がしても、コード本体は残っている", () => {
    expect(selectorCode).toMatch(/useVariantSelection/);
    expect(contextCode).toMatch(/createContext/);
  });
});
