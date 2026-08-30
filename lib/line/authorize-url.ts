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
 * したがってコード側でできることは 3 つである:
 *
 *   1. 上記 3 つを**送らない**（`disable_auto_login` は自動ログイン失敗からの復帰時のみ）
 *   2. 認可 URL を**ユーザーの実 `<a>` タップ**で開く（JavaScript リダイレクト /
 *      URL 直打ちは Universal Links を発火させないと公式に明記）
 *   3. **そのタップの着地点を、LINE アプリに結び付いた URL にする**（下記）
 *
 * 2 は各ボタン側の責務（`line-login-button.tsx` / `line-linkage-cta.tsx`）。
 * **1 と 3 はこの関数の責務**であり、`__tests__/line-authorize-url.test.ts` が固定する。
 *
 * ## 3 が要る理由（PR #180 で残っていた穴）
 *
 * PR #180 は 1 と 2 を満たしたが、それでも iPhone の Chrome では行き止まったままだった。
 * 理由は **タップの着地点 `access.line.me` がそもそもアプリに結び付いていない**こと
 * である。OS が読む association ファイルの実測（2026-08-30）:
 *
 *   - `https://access.line.me/.well-known/apple-app-site-association` … 本文 0 バイト
 *   - `https://access-auto.line.me/.well-known/apple-app-site-association` …
 *     `appID: ZW4U99SQQ3.jp.naver.line` / `paths: ["/dialog/oauth/weblogin",
 *     "/oauth2/v2.1/login"]`
 *
 * つまりアプリが開く URL は `access-auto.line.me/oauth2/v2.1/login` **だけ**であり、
 * 自動ログインとは「LINE の画面がそこへ内部で遷移する」ことに他ならない。内部遷移は
 * 公式が「Universal Links may not work」と名指しする形（JS リダイレクト / URL 直打ち）
 * であり、iOS の Safari 以外ではそこで切れる。だから **利用者のタップを直接その URL に
 * 着地させる**。LINE 自身が access.line.me のログイン画面下部に出す
 * 「LINEアプリでログイン」リンクと同じ URL 形である。
 *
 * ⚠ この受け渡し URL の組み立て（`returnUri` + `loginChannelId`）は **公式の
 * パラメータ表には無い**。よって適用先は「今日すでに壊れている環境」だけに絞る
 * （`shouldUseLineAppHandoff`）。外れても行き先は LINE の通常ログイン画面 = 今日と
 * 同じ画面なので、失うものは無い。
 *
 * 一次情報:
 *   https://developers.line.biz/en/docs/line-login/integrate-line-login/#making-an-authorization-request
 *   https://developers.line.biz/en/docs/line-login/integrate-line-login/#line-auto-login
 *   https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 *   https://developer.apple.com/documentation/xcode/supporting-associated-domains
 */
import type { NextRequest } from "next/server";

import {
  classifyAutoLoginEnvironment,
  shouldUseLineAppHandoff,
} from "./auto-login-environment";
import {
  LINE_APP_HANDOFF_PATH,
  lineAppHandoffBaseUrl,
  lineAuthBaseUrl,
} from "./endpoints";

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
  /**
   * **タップの着地点を LINE アプリ側にする**（既定 false）。
   *
   * true にすると、返る URL は認可エンドポイントではなく
   * `access-auto.line.me/oauth2/v2.1/login?returnUri=…&loginChannelId=…` になる。
   * 認可要求そのものは `returnUri` の中にそのまま入るので、載るパラメータは
   * どちらでも同一である（`AUTO_LOGIN_KILLING_PARAMS` の検査も両方に効く）。
   *
   * 判定は呼び出し側で `lineAppHandoffFromRequest(request)` を使うこと。
   * 自前で UA を見ないのは、方針を 1 か所に閉じ込めるという本モジュールの趣旨と
   * 同じ理由である。
   */
  appHandoff?: boolean;
};

/**
 * 認可要求のクエリ。`buildLineAuthorizeUrl` の 2 つの出力に共通の本体。
 *
 * ここに無いパラメータは載らない。載せたくなったら、まず上の
 * `AUTO_LOGIN_KILLING_PARAMS` と一次情報を読むこと。
 */
function lineAuthorizeParams(input: LineAuthorizeUrlInput): URLSearchParams {
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

  return params;
}

/**
 * ユーザーのタップ先 URL を組み立てる。
 *
 * 既定は公式の認可エンドポイント。`appHandoff` を立てたときだけ、LINE アプリに
 * 結び付いた受け渡し URL を返す（中身の認可要求は同一）。
 */
export function buildLineAuthorizeUrl(input: LineAuthorizeUrlInput): string {
  const authorizePath = `/oauth2/v2.1/authorize?${lineAuthorizeParams(input)}`;

  /* `disableAutoLogin` が立っている回は、**自動ログインを避けるための再試行**である
   * （直前の往復がアプリ受け渡しに失敗している）。そこでアプリ側へ着地させると、
   * 同じ失敗をもう一度踏ませることになる。受け渡しより再試行の意図が優先する。 */
  if (!input.appHandoff || input.disableAutoLogin) {
    return `${lineAuthBaseUrl()}${authorizePath}`;
  }

  /* LINE 自身の「LINEアプリでログイン」リンクと同じ形。`loginChannelId` が無いと
   * LINE は 400 を返す（2026-08-30 実測）。`loginState` は LINE の画面が自分の
   * セッション用に載せる値で、**必須ではない**（同実測: 未指定・不正値とも 200 で
   * 通常のログイン画面が返る）ため、こちらからは組み立てない。 */
  const handoff = new URLSearchParams({
    returnUri: authorizePath,
    loginChannelId: input.channelId,
  });

  return `${lineAppHandoffBaseUrl()}${LINE_APP_HANDOFF_PATH}?${handoff}`;
}

/**
 * この要求の相手に対して、アプリ受け渡し URL を出すべきか。
 *
 * 認可 URL を作る経路（ログイン / 旧 302 / 連携）が**同じ判定**を使うための入口。
 * 経路ごとに UA を見ると、片方だけ直って片方が残る — それが PR #180 の直前まで
 * 3 経路で起きていたことそのものである。
 */
export function lineAppHandoffFromRequest(request: NextRequest): boolean {
  return shouldUseLineAppHandoff(
    classifyAutoLoginEnvironment(request.headers.get("user-agent")),
  );
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
