/**
 * ブックマークボタンが**最初の描画から押せる**ことを縛る。
 *
 * ## 直している症状
 *
 * ボタンの無効化条件が「書き込み中」から「認証・登録状態の解決中」へ広がっていた
 * (`disabled={isResolving}`)。`isResolving` は
 * `authState === "unknown" || checkState === "checking"` で、どちらもマウント直後は
 * 必ず真になる:
 *
 *   - `authState` … cookie はクライアントでしか読めないので SSR では `unknown`
 *   - `checkState` … 登録済みかを `/api/user/favorites` に往復で問い合わせている間 `checking`
 *
 * つまり**記事を開いた直後、往復が終わるまでボタンは押せない**。回線が遅ければ数秒。
 * しかも無効化の理由は画面に出ないので、お客さまからは「お気に入りが壊れている」
 * としか見えない。実際、報告された「押しても反応しない」はここだった。
 *
 * ## 何を縛るか
 *
 * SSR 相当の最初の描画 (= `authState` も `checkState` も未解決) で
 * **`disabled` が付かないこと**。これが今回の回帰そのもので、`disabled={isPending}`
 * (書き込み中だけ無効) に戻っている限り緑になる。`isResolving` を無効化条件へ
 * 戻した瞬間に赤くなる。
 *
 * 併せて、押せることと引き換えに落としてはいけない 2 点も見る:
 *
 *   - `aria-busy="true"` … 解決中であること自体は支援技術へ伝え続ける
 *     (「押せる」と「もう確定している」は別)
 *   - ラベルが `loadingLabel` … 状態は文字列で読み上げる設計 (aria-label を被せない)
 *
 * ## なぜ静的描画で足りるか
 *
 * 見たいのは「最初の描画で押せるか」だけで、押下後の分岐 (確認 → 実行) はブラウザが要る。
 * `renderToStaticMarkup` は effect を走らせないので、初期状態がそのまま出る — この
 * テストが見たい状態と一致する。押下側の挙動は e2e の担当。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BookmarkButton } from "@/components/journal/bookmark-button";

const LOADING_LABEL = "ブックマークの状態を確認しています";

/**
 * `<button ...>` の開きタグから `disabled` **属性**の有無を見る。
 *
 * 素朴に `html.includes("disabled")` で見てはいけない。shadcn の Button は
 * `disabled:pointer-events-none` / `disabled:opacity-50` という Tailwind の
 * クラス名を常に持っているので、無効化されていなくても必ず引っかかる
 * (＝どんな実装でも赤くなる、意味の無いテストになる)。
 *
 * 属性としての `disabled` だけを拾うため、直後が `:` でないことを見る。
 */
function isDisabled(html: string): boolean {
  const openTag = /<button\b[^>]*>/.exec(html);
  if (!openTag) throw new Error("button が描画されていない");
  return /\sdisabled(=|\s|>)/.test(openTag[0]);
}

function renderInitial(): string {
  return renderToStaticMarkup(
    <BookmarkButton
      articleSlug="test-article"
      articleTitle="テスト記事"
      articleImageUrl={null}
      addLabel="ブックマークに追加"
      removeLabel="ブックマークから削除"
      savedLabel="保存済み"
      loadingLabel={LOADING_LABEL}
      loginRequiredLabel="ログインして保存"
      statusUnknownLabel="状態を取得できませんでした"
      addedMessage="追加しました"
      removedMessage="削除しました"
      errorMessage="失敗しました"
      loginRequiredMessage="ログインが必要です"
      statusRetryMessage="もう一度確認しています"
    />
  );
}

describe("BookmarkButton / 確認が終わる前でも押せる", () => {
  it("最初の描画で disabled が付かない（確認の往復で押下を握り潰さない）", () => {
    expect(isDisabled(renderInitial())).toBe(false);
  });

  /* 検出器そのものが効いていることを見る。`isDisabled` が常に false を返す
     ようになれば上のテストは実装が壊れても緑のままになるので、無効化された
     ボタンをちゃんと拾えることを 1 度だけ確かめておく。 */
  it("（検出器の自己点検）disabled 属性が付いていれば true を返す", () => {
    expect(isDisabled('<button type="button" disabled="">x</button>')).toBe(true);
    expect(
      isDisabled('<button class="disabled:opacity-50">x</button>')
    ).toBe(false);
  });

  it("押せるようにしても、解決中であることは aria-busy で伝え続ける", () => {
    const html = renderInitial();

    expect(html).toContain('aria-busy="true"');
  });

  it("解決中のラベルは loadingLabel を出す（状態は文字列で読み上げる）", () => {
    const html = renderInitial();

    expect(html).toContain(LOADING_LABEL);
    expect(html).toContain('data-state="loading"');
  });
});
