/**
 * LINE 認可 URL を組み立てる**唯一の場所**。
 *
 * ## なぜ 1 関数に寄せるのか（この修正の本体）
 *
 * 認可 URL を組み立てる場所は、これまで **3 つ**あった。
 *
 *   - `app/api/line-login/init/route.ts`      … `/login` のボタンが読む（POST → authUrl）
 *   - `app/api/line-login/route.ts`           … 旧経路（GET → 302）。本番で今も生きている
 *   - `app/api/user/line-link/init/route.ts`  … マイページの「LINEと連携する」
 *
 * 3 つとも `new URLSearchParams({...})` を**別々に**書いていた。載せる値も、載せて
 * はいけない値も、それぞれの route のコメントに書かれているだけで、**機械が守って
 * いるものは何も無かった**。
 *
 * これは「スマホで LINE アプリが立ち上がらない」が何度直しても再発した構造そのもの
 * である。自動ログインを殺すパラメータ（下記）は 1 本混ざれば十分で、混ざった場所が
 * 3 つのうちどれか 1 つでも、その導線を通った人にだけ症状が出る。直した人は自分が
 * 通った導線しか見ないので、残り 2 本は生き残る。
 *
 * よって **パラメータの方針をこの関数に閉じ込め、route からは値だけ渡す**。以後、
 * 新しい導線が増えてもここを通る限り方針は一致する。
 *
 * ## 自動ログイン（auto login）とは何か
 *
 * スマホで「LINEでログイン」を押したとき、access.line.me のメール/パスワード/QR 画面を
 * 経ずに LINE アプリの認証へ直行する LINE の機能。**既定で有効**で、有効化する
 * パラメータは存在しない。逆に、**無効化する**パラメータは公式に 3 つある:
 *
 *   - `prompt=login`             … 「if you set `login`, auto login is disabled」
 *   - `disable_auto_login=true`  … 「If set to `true`, auto login will be disabled」
 *   - `disable_ios_auto_login=true` … 「auto login will be disabled in iOS」
 *
 * したがってコード側でできることは 2 つだけである:
 *
 *   1. 上記 3 つを**送らない**（`disable_auto_login` は自動ログイン失敗からの復帰時のみ）
 *   2. 認可 URL を**ユーザーの実 `<a>` タップ**で開く（JavaScript リダイレクト /
 *      URL 直打ちは Universal Links を発火させないと公式に明記）
 *
 * 2 は各ボタン側の責務（`line-login-button.tsx` / `line-linkage-cta.tsx`）。
 * **1 はこの関数の責務**であり、`__tests__/line-authorize-url.test.ts` が固定する。
 *
 * 一次情報:
 *   https://developers.line.biz/en/docs/line-login/integrate-line-login/#making-an-authorization-request
 *   https://developers.line.biz/en/docs/line-login/integrate-line-login/#line-auto-login
 *   https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 */
import type { NextRequest } from "next/server";

import { lineAuthBaseUrl } from "./endpoints";

/**
 * 送った瞬間に自動ログインが死ぬパラメータ。
 *
 * 「送ってはいけない」を**名前の配列**として持つのは、テストがこの配列を回して
 * 全経路を検査できるようにするため。コメントで禁じるだけでは次の人が増やせてしまう。
 *
 * `disable_auto_login` だけは例外的に**意図して送る**場面がある（自動ログインが
 * 失敗した後の 1 回だけ / LINE 公式の復帰手順）。だから禁止リストではなく
 * `disableAutoLogin` という明示の入力にしてあり、既定は false である。
 */
export const AUTO_LOGIN_KILLING_PARAMS = [
  "prompt",
  "disable_auto_login",
  "disable_ios_auto_login",
] as const;

export type LineAuthorizeUrlInput = {
  /** LINE Login チャネルの Channel ID（`client_id`）。 */
  channelId: string;
  /** 認可後の戻り先。自ホストの絶対 URL。 */
  redirectUri: string;
  /** CSRF 用の使い捨て値。cookie 側と対で発行する。 */
  state: string;
  /** OIDC の使い捨て値。id_token をこの要求に束縛する。 */
  nonce: string;
  /** `"profile openid"` 等。scope の決定は `login-channel.ts` の責務。 */
  scope: string;
  /**
   * 公式アカウントの友だち追加を促すか。`null` / 未指定で送らない。
   *
   * ⚠ `prompt` とは**別のパラメータ**である。`bot_prompt` は自動ログインを
   * 無効化しない（公式のパラメータ表に自動ログインへの言及が無く、実測でも
   * 付与の有無で `access-auto.line.me` への遷移は変わらない）。
   */
  botPrompt?: "aggressive" | "normal" | null;
  /**
   * LINE 側の画面の言語。未指定だと LINE は `Accept-Language` から推測し、
   * 日本語利用者に英語の画面が出ることがある（2026-08-30 実測: `lang=en_US`）。
   * サイトのロケールが分かっているなら渡す。
   */
  uiLocales?: string | null;
  /**
   * **自動ログインを切る**。既定 false。
   *
   * true にしてよいのは「直前の往復が自動ログイン失敗だった」と分かっているとき
   * だけである（LINE 公式の復帰手順）。既定で切ると、この導線が存在する理由その
   * ものを毎回潰す。判定は `lib/line/auto-login.ts`。
   */
  disableAutoLogin?: boolean;
};

/**
 * 認可 URL を組み立てる。
 *
 * ここに無いパラメータは載らない。載せたくなったら、まず上の
 * `AUTO_LOGIN_KILLING_PARAMS` と一次情報を読むこと。
 */
export function buildLineAuthorizeUrl(input: LineAuthorizeUrlInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.channelId,
    redirect_uri: input.redirectUri,
    state: input.state,
    nonce: input.nonce,
    scope: input.scope,
  });

  if (input.botPrompt) params.set("bot_prompt", input.botPrompt);
  if (input.uiLocales) params.set("ui_locales", input.uiLocales);

  /* 既定では**送らない**。送るのは呼び出し側が明示したときだけ。 */
  if (input.disableAutoLogin) params.set("disable_auto_login", "true");

  return `${lineAuthBaseUrl()}/oauth2/v2.1/authorize?${params.toString()}`;
}

/**
 * LINE 側の画面に出す言語（`ui_locales`）を要求から決める。
 *
 * 渡さないと LINE は `Accept-Language` から推測する。2026-08-30 の本番実測では
 * LINE のログイン画面が `lang=en_US` で返ってきた — 日本語の店で、日本語で
 * 「LINEでログイン」を押した人に英語の画面が出うるということである。
 * サイトのロケールは分かっているのだから、そのまま伝える。
 *
 * 判定順は next-intl の cookie → `ja`。`Accept-Language` は見ない（サイトの
 * 表示言語と食い違うと、かえって画面がちぐはぐになる）。
 */
export function lineUiLocales(request: NextRequest): string {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  return cookieLocale === "en" ? "en" : "ja";
}
