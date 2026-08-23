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
import { readUrlEnvTrimmed } from "@/lib/env";

/** LINE の認可ホスト（LINE Login の authorize / 連携ダイアログ / ID トークンの `iss`）。 */
export const LINE_AUTH_BASE_URL_DEFAULT = "https://access.line.me";

/** LINE の API ホスト（token / profile / verify / Messaging push）。 */
export const LINE_API_BASE_URL_DEFAULT = "https://api.line.me";

/**
 * LINE 認可ホストのベース URL。env `LINE_AUTH_BASE_URL`、未設定なら本物の LINE。
 *
 * `readUrlEnvTrimmed` を通すのは、`vercel env add` などで末尾改行が紛れ込むと
 * `https://access.line.me\n/oauth2/...` という壊れた URL になり、ダッシュボードでもログでも
 * 気づけない失敗になるため（lib/env.ts の冒頭に経緯）。末尾スラッシュも落ちるので、呼び出し側は
 * 常に `${base}/path` と書ける。
 */
export function lineAuthBaseUrl(): string {
  return readUrlEnvTrimmed(process.env.LINE_AUTH_BASE_URL, LINE_AUTH_BASE_URL_DEFAULT);
}

/** LINE API ホストのベース URL。env `LINE_API_BASE_URL`、未設定なら本物の LINE。 */
export function lineApiBaseUrl(): string {
  return readUrlEnvTrimmed(process.env.LINE_API_BASE_URL, LINE_API_BASE_URL_DEFAULT);
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
