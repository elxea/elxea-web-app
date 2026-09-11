/**
 * 保存トグル (`FavoriteToggleButton`) の初期描画と、**途中の文言が存在しないこと**を縛る。
 *
 * ## 直している症状 (Setaka 実機指摘 2026-08-25)
 *
 * 保存ボタンはマウントのたびに 1 個ずつ `?check=` を叩き、その往復が終わるまで
 * 「ブックマークの状態を確認しています」という**別の文言**を出していた。文字幅が
 * 変わるのでその場のレイアウトが動き、押しても反応が無いように見えた。
 *
 * 縛る契約:
 *   1. 最初の描画で `disabled` が付かない (押下を握り潰さない)。
 *   2. **途中の文言を出さない** — 最初の描画のラベルは素の「保存する」。
 *      文字が後から差し替わらないので、その場のレイアウトも動かない。
 *   3. 状態が分かっていないときは `aria-pressed` を名乗らない
 *      (未登録と断定できないため)。
 *   4. どの種類・どの見た目でも 1 実装で描ける (D-12: 4 実装 → 1 実装)。
 *
 * 押下後の分岐 (実体の確認 → 実行 → 失敗ロールバック) はブラウザが要るので
 * story (`components/favorites/favorite-toggle-button.stories.tsx`) の担当。
 * `renderToStaticMarkup` は effect を走らせないため、ここに出るのは
 * 「マウント直後 = 何も解決していない状態」そのもの。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FavoriteToggleButton,
  type FavoriteToggleAppearance,
} from "@/components/favorites/favorite-toggle-button";
import { FAVORITE_KINDS } from "@/lib/account-favorites";

const ADD = "この人を保存";

const labels = {
  add: ADD,
  remove: "保存をやめる",
  saved: "保存済み",
  added: "保存しました",
  removed: "保存をやめました",
  error: "失敗しました",
  loginRequiredMessage: "ログインが必要です",
};

/**
 * `<button ...>` の開きタグから `disabled` **属性**の有無を見る。
 *
 * `html.includes("disabled")` では駄目 — shadcn の Button は
 * `disabled:pointer-events-none` 等のクラス名を常に持つので、無効化されていなくても
 * 必ず引っかかる (どんな実装でも赤くなる無意味なテストになる)。
 */
function isDisabled(html: string): boolean {
  const openTag = /<button\b[^>]*>/.exec(html);
  if (!openTag) throw new Error("button が描画されていない");
  return /\sdisabled(=|\s|>)/.test(openTag[0]);
}

function renderInitial(
  kind: (typeof FAVORITE_KINDS)[number] = "person",
  appearance: FavoriteToggleAppearance = "panel"
): string {
  return renderToStaticMarkup(
    <FavoriteToggleButton
      kind={kind}
      targetId="masayuki-kubo"
      title="久保 雅之"
      imageUrl={null}
      appearance={appearance}
      labels={labels}
    />
  );
}

describe("FavoriteToggleButton / 最初の描画", () => {
  it("取り込みが終わる前でも押せる (押下を握り潰さない)", () => {
    expect(isDisabled(renderInitial())).toBe(false);
  });

  /* 検出器の自己点検。`isDisabled` が常に false を返すようになれば上のテストは
     実装が壊れても緑のままになる。 */
  it("(検出器の自己点検) disabled 属性が付いていれば true を返す", () => {
    expect(isDisabled('<button type="button" disabled="">x</button>')).toBe(true);
    expect(isDisabled('<button class="disabled:opacity-50">x</button>')).toBe(false);
  });

  it("途中の文言を出さない — 最初から素の「保存する」で、後から差し替わらない", () => {
    const html = renderInitial();

    expect(html).toContain(ADD);
    /* 「確認しています」系の文字列がどこにも出ない。文字幅が変わらないので
       その場のレイアウトも動かない (Setaka 実機指摘の本体)。 */
    expect(html).not.toMatch(/確認しています|Checking/);
    expect(html).not.toContain('data-state="loading"');
  });

  it("状態が分かっていないときは aria-pressed を名乗らない", () => {
    const html = renderInitial();

    expect(html).toContain('data-state="unknown"');
    expect(html).not.toContain("aria-pressed");
  });

  it("どの種類・どの見た目でも 1 実装で描ける (4 実装 → 1 実装)", () => {
    for (const kind of FAVORITE_KINDS) {
      expect(renderInitial(kind), kind).toContain(`data-kind="${kind}"`);
    }
    for (const appearance of ["panel", "product", "icon"] as const) {
      expect(isDisabled(renderInitial("product", appearance)), appearance).toBe(false);
    }
  });
});

describe("保存ボタンの実装が 1 本に寄っていること (D-12)", () => {
  const root = join(__dirname, "..");

  it("種類ごとの重複実装がリポジトリに残っていない", () => {
    for (const removed of [
      "components/product/favorite-button.tsx",
      "components/journal/bookmark-button.tsx",
    ]) {
      expect(() => readFileSync(join(root, removed), "utf8"), removed).toThrow();
    }
  });

  it("ログイン判定のコピーが倉庫 1 か所に集まっている", () => {
    /* 以前この 1 行は保存ボタン 4 実装すべてに複製されていた。増えていないことを見る。
       (`follows` 系は Wave 4 の後段で畳むため、まだ 1 件残っていてよい) */
    const button = readFileSync(
      join(root, "components/favorites/favorite-toggle-button.tsx"),
      "utf8"
    );
    expect(button).not.toContain("shop_auth=1");
    expect(button).toContain("isFavoritesAuthed");
  });

  it("途中の文言そのものが messages から消えている", () => {
    for (const file of ["messages/ja.json", "messages/en.json"]) {
      const raw = readFileSync(join(root, file), "utf8");
      for (const key of [
        "bookmarkLoading",
        "bookmarkStatusUnknown",
        "bookmarkStatusRetry",
        "saveLoading",
        "saveStatusUnknown",
        "saveStatusRetryMessage",
      ]) {
        expect(raw, `${file} / ${key}`).not.toContain(`"${key}"`);
      }
    }
  });
});

describe("詳細ページの配線", () => {
  const root = join(__dirname, "..");

  /* 画面の配線そのもの (どの種類で・何を targetId にして保存するか) は、
     取り違えると「保存できたのにマイページに出ない」「別人が保存される」に
     直結するのでここで縛る。 */
  it("人の slug を識別子にして person として保存する", () => {
    const page = readFileSync(
      join(root, "app/[locale]/people/[slug]/page.tsx"),
      "utf8"
    );

    expect(page).toContain('kind="person"');
    expect(page).toContain("targetId={person.slug.current}");
    expect(page).toContain("title={person.name}");
  });

  it("商品は handle を識別子にして product として保存する", () => {
    const page = readFileSync(
      join(root, "app/[locale]/products/[handle]/page.tsx"),
      "utf8"
    );

    expect(page).toContain('kind="product"');
    expect(page).toContain("targetId={product.handle}");
  });

  it("読みものは slug を識別子にして article として保存する", () => {
    const page = readFileSync(
      join(root, "app/[locale]/(reading)/journal/[slug]/page.tsx"),
      "utf8"
    );

    expect(page).toContain('kind="article"');
    expect(page).toContain("targetId={slug}");
  });
});
