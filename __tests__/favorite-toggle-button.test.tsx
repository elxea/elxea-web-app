/**
 * 種類を問わない保存トグル (`FavoriteToggleButton`) の初期描画を縛る。
 *
 * F4 で人 (`/people/[slug]`) を 3 つ目のお気に入りの種類として足すにあたり、
 * 記事・商品と同じ動きの実装をもう 1 本増やさないために、種類を引数にした
 * 共通部品を置いた。記事の保存ボタンが積み上げてきた不具合修正 (押せない /
 * 状態不明を未登録と偽る / 遅れて届いた確認応答が確定した保存を巻き戻す) を
 * 引き継いでいることを、押下を要さない範囲でここに縛る。
 *
 * 押下後の分岐 (確認 → 実行 → 失敗ロールバック) はブラウザが要るので e2e の担当。
 * `renderToStaticMarkup` は effect を走らせないため、ここに出るのは
 * 「マウント直後 = 何も解決していない状態」そのもの。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FavoriteToggleButton } from "@/components/favorites/favorite-toggle-button";
import { FAVORITE_KINDS } from "@/lib/account-favorites";

const LOADING = "保存の状態を確認しています";

const labels = {
  add: "この人を保存",
  remove: "保存をやめる",
  saved: "保存済み",
  loading: LOADING,
  loginRequired: "ログインすると保存できます",
  statusUnknown: "保存の状態を取得できませんでした",
  added: "保存しました",
  removed: "保存をやめました",
  error: "失敗しました",
  loginRequiredMessage: "ログインが必要です",
  statusRetry: "もう一度確認しています",
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

function renderInitial(kind: (typeof FAVORITE_KINDS)[number] = "person"): string {
  return renderToStaticMarkup(
    <FavoriteToggleButton
      kind={kind}
      targetId="masayuki-kubo"
      title="久保 雅之"
      imageUrl={null}
      labels={labels}
    />
  );
}

describe("FavoriteToggleButton / 最初の描画", () => {
  it("確認の往復が終わる前でも押せる (押下を握り潰さない)", () => {
    expect(isDisabled(renderInitial())).toBe(false);
  });

  /* 検出器の自己点検。`isDisabled` が常に false を返すようになれば上のテストは
     実装が壊れても緑のままになる。 */
  it("(検出器の自己点検) disabled 属性が付いていれば true を返す", () => {
    expect(isDisabled('<button type="button" disabled="">x</button>')).toBe(true);
    expect(isDisabled('<button class="disabled:opacity-50">x</button>')).toBe(false);
  });

  it("押せるようにしても、解決中であることは aria-busy で伝え続ける", () => {
    expect(renderInitial()).toContain('aria-busy="true"');
  });

  it("解決中のラベルを文字列で出す (aria-label で別の名前を被せない)", () => {
    const html = renderInitial();

    expect(html).toContain(LOADING);
    expect(html).toContain('data-state="loading"');
    expect(html).not.toContain("aria-label=");
  });

  it("どの種類でも描ける (種類は引数、実装は 1 本)", () => {
    for (const kind of FAVORITE_KINDS) {
      expect(renderInitial(kind), kind).toContain(`data-kind="${kind}"`);
    }
  });
});

describe("人の詳細ページの配線", () => {
  /* 画面の配線そのもの (どの種類で・何を targetId にして保存するか) は、
     取り違えると「保存できたのにマイページに出ない」「別人が保存される」に
     直結するのでここで縛る。 */
  it("人の slug を識別子にして person として保存する", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(
      join(__dirname, "..", "app/[locale]/people/[slug]/page.tsx"),
      "utf8"
    );

    expect(page).toContain('kind="person"');
    expect(page).toContain("targetId={person.slug.current}");
    expect(page).toContain("title={person.name}");
  });
});
