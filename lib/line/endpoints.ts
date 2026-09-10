/**
 * LINE の接続先ホストの単一の定義場所。
 *
 * ## なぜ env で差し替えられる必要があるのか
 *
 * LINE ログインを含む経路の自動テストは「本物の LINE ログイン画面をブラウザで突破する」方式が
 * 成立しない（LINE の開発ガイドラインも、テストで LINE へ大量アクセスしないことを求めている）。
 * 代わりにローカルの偽 LINE サーバーへ向けて回す。ただし token 交換・profile 取得・verify・
 * push は **route handler から LINE へのサーバ間通信** なので、ブラウザ側の仕掛け（Playwright の
 * route intercept 等）では差し替えられない。サーバのコードが接続先を env から読める必要がある。
 *
 * この穴は仮定の話ではない: `app/api/line-callback` の SUCCESS 経路を一度も踏めなかったため、
 * このルートが発行するセッションクッキーを壊す変更がフルグリーンのまま通過したことがある。
 *
 * ## 本番への影響
 *
 * 既定値は本物の LINE ホスト。env 未設定なら組み立てられる URL は現行と**完全に同一**になる。
 * 本番は env を足さない限り挙動が一切変わらない（このモジュールの導入はリファクタ）。
 *
 * ## なぜ env を 2 本に分けるのか
 *
 * LINE 側でも `access.line.me`（認可・連携ダイアログ・ID トークンの発行者）と `api.line.me`
 * （token / profile / verify / Messaging push）は別ホスト。偽サーバーでも「認可だけ差し替える」
 * 「API だけ差し替える」を独立に行いたいので 1 本にまとめない。
 *
 * ## なぜ module-level const ではなく関数か
 *
 * const は import 時に env を固定するため、テストが env を差し替える前に評価され得る。呼び出しの
 * たびに読むことで、同一プロセスで「既定値」と「差し替え」の両方を検証できる。URL 文字列を組む
 * だけなのでコストは無視できる。
 */
import { env } from "@/lib/config";

/** LINE の認可ホスト（LINE Login の authorize / 連携ダイアログ / ID トークンの `iss`）。 */
export const LINE_AUTH_BASE_URL_DEFAULT = "https://access.line.me";

/** LINE の API ホスト（token / profile / verify / Messaging push）。 */
export const LINE_API_BASE_URL_DEFAULT = "https://api.line.me";

/**
 * **LINE アプリへの受け渡しホスト**。認可ホストとは別物で、こちらが Universal Link /
 * App Link の登録先である。
 *
 * ## なぜ別ホストなのか（この修正の根拠）
 *
 * 「タップで LINE アプリを開く」は iOS の Universal Links / Android の App Links で
 * 実現されており、どの host + path がアプリに結び付いているかは **OS が読む association
 * ファイルが正本**である。実測（2026-08-30）:
 *
 * ```
 * $ curl https://access.line.me/.well-known/apple-app-site-association
 * （HTTP 200 / 本文 0 バイト・content-type も付かない）
 *
 * $ curl https://access-auto.line.me/.well-known/apple-app-site-association
 * {"applinks":{"apps":[],"details":[{"appID":"ZW4U99SQQ3.jp.naver.line",
 *   "paths":["/dialog/oauth/weblogin","/oauth2/v2.1/login"]}]}}
 *
 * $ curl https://access-auto.line.me/.well-known/assetlinks.json
 * [{"relation":["delegate_permission/common.handle_all_urls"],
 *   "target":{"namespace":"android_app","package_name":"jp.naver.line.android", …}}]
 * ```
 *
 * つまり **`access.line.me` はアプリに結び付いていない**。認可 URL
 * (`https://access.line.me/oauth2/v2.1/authorize?…`) をタップしても、OS から見れば
 * それはただの Web ページであって、アプリを開く候補ですらない。アプリが開くのは
 * LINE の画面がその後 `access-auto.line.me/oauth2/v2.1/login` へ**内部で遷移した**
 * ときだけである。
 *
 * そして LINE 公式は、まさにその形が失敗すると書いている:
 *
 * > Universal Links may not work in the following cases:
 * > - Redirects a user to an authorization URL by JavaScript.
 * > - A user types the URL and goes directly to the authorization URL.
 * >
 * > … let users tap a button to go to the authorization URL and start the login process.
 * > — https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 *
 * PR #180 は「実 `<a>` タップにする」を満たしたが、**タップの着地点が
 * `access.line.me` のまま**だったので、アプリに結び付いた URL へは相変わらず
 * 内部遷移でしか到達していなかった。iPhone の Safari 以外ではそこで切れる。
 *
 * よって受け渡しが要る環境では、**タップの着地点そのものを
 * `access-auto.line.me/oauth2/v2.1/login` にする**。これは LINE 自身が
 * access.line.me のログイン画面下部に出す「LINEアプリでログイン」リンクと同じ URL 形
 * である（実測: `<a href="{auto-login-fallback-url}">` = このホスト + このパス +
 * `returnUri` + `loginChannelId`）。
 *
 * 一次情報:
 *   https://developer.apple.com/documentation/xcode/supporting-associated-domains
 *   https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 */
export const LINE_APP_HANDOFF_BASE_URL_DEFAULT = "https://access-auto.line.me";

/**
 * 受け渡しホスト上で **アプリに結び付いているパス**。
 *
 * `apple-app-site-association` の `paths` に載っている値そのもの。ここを外れた URL は
 * （同じホストでも）Universal Link として扱われず、アプリは開かない。値を変えるときは
 * 上記 association ファイルを実際に引いて確かめること。
 */
export const LINE_APP_HANDOFF_PATH = "/oauth2/v2.1/login";

/**
 * LINE 認可ホストのベース URL。env `LINE_AUTH_BASE_URL`、未設定なら本物の LINE。
 *
 * 設定レジストリ (`lib/config/spec.ts`) を通すのは、`vercel env add` などで末尾改行が
 * 紛れ込むと `https://access.line.me\n/oauth2/...` という壊れた URL になり、ダッシュボードでも
 * ログでも気づけない失敗になるため（spec.ts の冒頭に経緯）。この 2 本は
 * `trimmedNoTrailingSlash` で宣言してあるので末尾スラッシュも落ち、呼び出し側は
 * 常に `${base}/path` と書ける。
 */
export function lineAuthBaseUrl(): string {
  return env("LINE_AUTH_BASE_URL") ?? LINE_AUTH_BASE_URL_DEFAULT;
}

/** LINE API ホストのベース URL。env `LINE_API_BASE_URL`、未設定なら本物の LINE。 */
export function lineApiBaseUrl(): string {
  return env("LINE_API_BASE_URL") ?? LINE_API_BASE_URL_DEFAULT;
}

/**
 * LINE アプリ受け渡しホストのベース URL。env `LINE_APP_HANDOFF_BASE_URL`、未設定なら本物。
 *
 * 認可ホスト（`LINE_AUTH_BASE_URL`）と**別の env にしてある**のは、本物の LINE でも
 * 別ホストだからである。1 本にまとめると、偽 LINE サーバーへ向けたテストで
 * 「認可ホストと受け渡しホストが同一である」という本番には無い前提が入り込み、
 * 「タップの着地点が別ホストであること」自体を検査できなくなる。
 */
export function lineAppHandoffBaseUrl(): string {
  return env("LINE_APP_HANDOFF_BASE_URL") ?? LINE_APP_HANDOFF_BASE_URL_DEFAULT;
}

/**
 * 「LINE の認可ホスト配下の URL か」を前方一致で判定するための前置き文字列。
 *
 * オープンリダイレクト防止のホワイトリストに使う。末尾のスラッシュは必須で、これが無いと
 * `https://access.line.me.evil.example/` のような別ホストが前方一致で通ってしまう。
 */
export function lineAuthRedirectPrefix(): string {
  return `${lineAuthBaseUrl()}/`;
}
