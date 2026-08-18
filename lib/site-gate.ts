/**
 * サイト全体のパスワード gate を「開ける / 掛ける / 閉じる」のどれにするかだけを
 * 決める純関数。middleware から env の読み取りと分離してあるのは、判定を
 * リクエストに触らずテストできるようにするため。
 *
 * ここで守っている性質:
 *
 *  - **本番は fail-closed**。以前は `if (!SITE_PASSWORD) return null;` で、
 *    環境変数が消えた瞬間に全ページが誰でも見られる状態 (fail-open) になった。
 *    未公開サイトでこれは事故なので、本番で設定が無ければ配信を拒否する側に倒す。
 *  - **ローカル開発は従来どおり開く**。env が無いだけでローカルが一切開けなく
 *    なると開発が止まるので、`VERCEL_ENV` 未設定 (= ローカル) は open のまま。
 *  - **preview は現状維持**。Preview URL 自体が推測不能で到達制限になっている
 *    という Setaka 承認済みの意図的仕様。ここでは変えない。
 *
 * 判定に使うのは Vercel がプラットフォーム側で注入する `VERCEL_ENV` と、サーバ
 * 側の `SITE_PASSWORD` だけ。リクエストヘッダ・ホスト名・クッキー等の
 * クライアント由来の入力は一切見ない (偽装で本番判定を外させないため)。
 */

export type SiteGateMode =
  /** gate を掛けない (素通り) */
  | "open"
  /** パスワード cookie を検査する (従来の staging 挙動) */
  | "require-password"
  /** 設定不備。何も配信せず閉じる (本番の fail-closed) */
  | "deny";

export interface SiteGateEnv {
  /** サイトパスワード。値そのものは扱わず「設定されているか」だけを見る。 */
  SITE_PASSWORD?: string;
  /** Vercel が注入する "production" | "preview" | "development"。ローカルは undefined。 */
  VERCEL_ENV?: string;
}

export function resolveSiteGateMode(env: SiteGateEnv): SiteGateMode {
  // Preview は従来どおり免除 (承認済みの意図的仕様)。SITE_PASSWORD の有無に
  // かかわらず open なので、判定順は以前の実装と等価。
  if (env.VERCEL_ENV === "preview") return "open";

  const configured = typeof env.SITE_PASSWORD === "string" && env.SITE_PASSWORD.trim() !== "";
  if (configured) return "require-password";

  // 未設定。本番だけ閉じる方向に倒し、ローカル (VERCEL_ENV 未設定) や
  // `vercel dev` (=development) は従来どおり開ける。
  return env.VERCEL_ENV === "production" ? "deny" : "open";
}

/** fail-closed で閉じたときに返す本文。設定不備の事実だけを伝え、中身は出さない。 */
export const SITE_GATE_DENY_BODY =
  "Service Unavailable: site password protection is not configured.";

export const SITE_GATE_DENY_STATUS = 503;

export const SITE_GATE_DENY_HEADERS: Record<string, string> = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};
