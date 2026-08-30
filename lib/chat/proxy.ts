/**
 * Chat proxy helpers (B2: Web proxy 化)
 *
 * ブラウザから cx-agent (Cloudflare Workers) を公開 URL で直叩きするのをやめ、
 * Next.js のサーバ経由 (route handler) で中継する。サーバ側で:
 *   1. ログイン済みユーザーの customer_id を「サーバの認証済みセッション」
 *      (Shopify Customer Account セッション) から取得する。ブラウザ自己申告は信用しない。
 *   2. cx-agent へ X-API-Key (SYNC_API_SECRET) 付きで転送し、verify 済み customer_id を渡す。
 *
 * [SEC-B なりすまし防止] proxy は "ブラウザが body/query で送ってくる shopify_customer_id"
 * を絶対に透過転送しない。必ずサーバセッションから導出した verifiedCustomerId のみを付ける。
 * これを破ると、proxy が X-API-Key を付けて信頼させるため「他人の customer_id を送るだけで
 * なりすませる」穴が再び開く。
 *
 * fail-closed: SYNC_API_SECRET 未設定なら X-API-Key を付けない = cx-agent 側は
 * customer_id を無視して匿名 web セッション扱い (line-callback / survey と同方針)。
 */
import { env, isProduction } from "@/lib/config";
import { getCustomerFromSession } from "@/lib/shopify/auth";

/** cx-agent のオリジン (末尾の /api/chat を除去)。survey / line-callback と同じ導出。 */
export const CX_AGENT_BASE_URL = (
  env("NEXT_PUBLIC_CHAT_API_URL") ?? "http://localhost:8787/api/chat"
).replace(/\/api\/chat\/?$/, "");

export interface ProxyAuth {
  /** cx-agent へ付与するヘッダー (X-API-Key を含みうる)。信頼できないときは空。 */
  headers: Record<string, string>;
  /** サーバセッションで verify 済みの customer_id (GID)。未ログインなら null。 */
  verifiedCustomerId: string | null;
  /**
   * サーバセッションで verify 済みの LINE userId。LINE ログインで入っている人だけ付く。
   *
   * 出どころは暗号化 cookie の復号結果 (= LINE 署名済み id_token の sub) で、
   * ブラウザ自己申告ではない。cx-agent 側は X-API-Key 検証済みのときだけこれを信じる。
   */
  verifiedLineUserId: string | null;
  /** SYNC_API_SECRET が設定されており cx-agent に信頼させられるか。 */
  trusted: boolean;
}

/**
 * 顧客 ID を cx-agent が受け取る形 (GID) に揃える。
 *
 * cx-agent の `validateShopifyCustomerId` は `gid://shopify/Customer/<digits>` しか
 * 受け付けない。Shopify セッション経路 (`getCustomerFromSession`) は元から GID だが、
 * `resolveIdentity()` は数値へ寄せた ID を返すので、ここで戻す。形が違うだけで
 * 400 になり、ログイン済みの人が黙って匿名扱いに落ちる — それを起こさないための正規化。
 */
function toCustomerGid(id: string): string {
  return /^\d+$/.test(id) ? `gid://shopify/Customer/${id}` : id;
}

/**
 * サーバセッションから verify 済み customer_id を取得し、X-API-Key ヘッダーを組み立てる。
 *
 * - trusted (SYNC_API_SECRET あり) かつ verifiedCustomerId ありのときだけ、呼び出し側は
 *   forward body / query に shopify_customer_id を付ける。
 * - SYNC_API_SECRET 未設定 = fail-closed。X-API-Key を付けないので cx-agent は customer_id を
 *   無視し匿名扱いになる (= verifiedCustomerId を転送しても意味がないので付けない)。
 */
export async function buildProxyAuth(): Promise<ProxyAuth> {
  /* 3 値で受ける。「未ログイン」も「判定できなかった」も転送する ID は無い
     (= 匿名) ので**挙動は同じ**だが、後者は既に Sentry に記録済みで、
     「なぜこの会話が匿名だったのか」を事後に追える。以前の catch は
     握り潰していたので、障害中に会話が顧客へ紐付かなくなっても痕跡が無かった。 */
  const result = await getCustomerFromSession();
  let verifiedCustomerId = result.ok ? (result.data?.id ?? null) : null;
  let verifiedLineUserId: string | null = null;

  /* ## LINE ログインで入っている人を「ログイン済み」として扱う (2026-08-30 の本番障害)
   *
   * ここは長く `getCustomerFromSession()` **だけ** を見ていた。これは Shopify の
   * セッション cookie しか読まないので、**LINE ログインで入っている人は必ず
   * `verifiedCustomerId = null`** になる。すると cx-agent へ identity が 1 つも
   * 渡らず、ログイン済みの本人の発言が匿名 web セッションとして保存される。
   * 結果、LINE 公式で「私の好みは？」と聞いても、サイトで話した内容を一切参照できない。
   *
   * `resolveIdentity()` は既にこの解決を持っている (Shopify セッション →
   * 顧客 ID / LINE セッション → 連携台帳の逆引きで顧客 ID)。マイページ・お気に入り・
   * 行動ログは全部これを使っており、**チャットだけが別の (狭い) 判定を持っていた**。
   *
   * 呼ぶ順は変えない: Shopify セッションで確定した人は従来どおりそのまま通し
   * (「判定できなかった」= 503 を「未ログイン」に畳まない R1 の作りを保つ)、
   * 顧客 ID が取れなかったときだけ `resolveIdentity()` に降りる。どちらも
   * `React.cache` 済みなので往復は増えない。 */
  if (!verifiedCustomerId) {
    /* 動的 import なのは **読み込みの輪を作らないため**。
       `lib/firebase/auth-guard` → `lib/line/linkage-status` → `lib/chat/proxy`
       (CX_AGENT_BASE_URL) と戻ってくるので、ここで静的に import すると
       proxy → auth-guard → linkage-status → proxy の循環になる。
       呼ばれるのはサーバの route handler の中だけなので、遅延で困らない。 */
    const { resolveIdentity } = await import("@/lib/firebase/auth-guard");
    const identity = await resolveIdentity();
    if (identity.authenticated) {
      verifiedLineUserId = identity.lineUserId ?? null;
      if (identity.shopifyCustomerId) {
        verifiedCustomerId = toCustomerGid(identity.shopifyCustomerId);
      }
    }
  }

  const secret = env("SYNC_API_SECRET");
  const headers: Record<string, string> = {};
  const trusted = !!secret;

  if (secret) {
    headers["X-API-Key"] = secret;
  } else if (isProduction()) {
    console.error(
      "[chat-proxy] SYNC_API_SECRET not set; requests downgraded to anonymous (verified customer_id will NOT be forwarded). Set SYNC_API_SECRET in production.",
    );
  }

  return { headers, verifiedCustomerId, verifiedLineUserId, trusted };
}

/**
 * ブラウザの実クライアント IP を cx-agent に転送するヘッダーを組み立てる。
 *
 * [なぜ必要か] cx-agent のレートリミット (10req/min) は「接続元 IP」でバケット分けする。
 * proxy 化すると全ユーザーが Vercel の egress IP に集約され、同一バケットで throttle され得る。
 * Cloudflare 側の CF-Connecting-IP は Cloudflare が自身で上書きするため proxy からは変えられない。
 * そのため実 IP を別ヘッダー (X-Forwarded-For / X-Real-Client-IP) で渡し、cx-agent 側が
 * 「X-API-Key 検証済み (= この proxy 由来) のときだけ」この値をレートリミットキーに使えるようにする。
 *
 * 現状は cx-agent 未対応のため no-op (無害) だが、follow-up で cx-agent が読むだけで per-user
 * レートリミットが復活する。信頼済み呼び出し (trusted=true) のときだけ付与する。
 */
export function clientIpForwardHeaders(
  forwardedFor: string | null,
  realIp: string | null,
  trusted: boolean,
): Record<string, string> {
  if (!trusted) return {};
  // Vercel はインフラ層で x-forwarded-for を設定する (先頭が実クライアント)。
  const clientIp = (forwardedFor?.split(",")[0]?.trim() || realIp || "").trim();
  if (!clientIp) return {};
  return {
    "X-Forwarded-For": clientIp,
    "X-Real-Client-IP": clientIp,
  };
}
