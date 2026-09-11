/**
 * Authentication guard for Firestore API routes.
 * Validates the Shopify session and extracts the customer ID.
 *
 * Performance optimization: if shop_cid cookie is present (set at login),
 * the Shopify Customer API call is skipped entirely. This reduces p50 latency
 * for authenticated API routes from ~400ms to ~5ms.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { getSession } from "@/lib/shopify/auth";
import { getCustomer, decryptToken } from "@/lib/shopify/customer";
import { fetchShopifyCustomerIdForLineUser } from "@/lib/line/linkage-status";
import { readVerifiedLineUserIdFrom } from "@/lib/line/session";
import { extractCustomerId } from "./types";

type AuthResult =
  | { authenticated: true; customerId: string; customerName: string }
  | { authenticated: false; error: string; status: number };

/**
 * Identity resolution result for Firestore API routes.
 *
 * `userKey` is the Firestore collection key abstraction that unifies Shopify
 * and LINE users:
 *   - Shopify users: `userKey = shopifyNumericId` (e.g. "7654321"),
 *     matching the existing Firestore layout — no migration required.
 *   - LINE users:    `userKey = "line:" + lineUserId` (e.g. "line:Uxxxx"),
 *     a disjoint namespace so the two providers never collide.
 */
export type Identity =
  | {
      authenticated: true;
      userKey: string;
      provider: "shopify" | "line";
      displayName: string;
      shopifyCustomerId: string | null;
      lineUserId: string | null;
    }
  | { authenticated: false; error: string; status: number };

/**
 * Validate the current session and return the customer's Firestore ID.
 * Returns the numeric portion of the Shopify customer GID.
 *
 * Fast path: reads customerId from encrypted shop_cid cookie (set at login via id_token).
 * Slow path: falls back to Shopify Customer API if cookie is absent or invalid.
 */
export async function requireAuth(): Promise<AuthResult> {
  try {
    // Verify that a valid session exists (checks shop_at + shop_rt cookies)
    const session = await getSession();
    if (!session) {
      return { authenticated: false, error: "Not authenticated", status: 401 };
    }

    // Fast path: use cached customer ID from id_token (set at login)
    const cookieStore = await cookies();
    const cidEnc = cookieStore.get("shop_cid")?.value;
    if (cidEnc) {
      const customerId = decryptToken(cidEnc);
      if (customerId) {
        return { authenticated: true, customerId, customerName: "Customer" };
      }
    }

    // Slow path: fetch customer from Shopify API (first login after deploy, or missing cookie)
    const customer = await getCustomer(session.accessToken);
    if (!customer) {
      return { authenticated: false, error: "Customer not found", status: 401 };
    }

    const customerId = extractCustomerId(customer.id);
    const customerName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ") || "Anonymous";

    return { authenticated: true, customerId, customerName };
  } catch {
    return { authenticated: false, error: "Authentication failed", status: 401 };
  }
}

/**
 * Resolve the current caller's identity across Shopify and LINE providers.
 *
 * Resolution order:
 *   1. Shopify session (shop_at + shop_rt) — preferred; provider = "shopify"
 *      and `userKey` is the numeric Shopify customer ID. Existing Firestore
 *      documents under `users/{numericId}` continue to work unchanged.
 *   2. LINE session (line_session + line_uid) — provider = "line" and
 *      `userKey = "line:" + lineUserId`.
 *   3. Otherwise unauthenticated.
 *
 * The two key namespaces are disjoint (LINE keys always carry the "line:"
 * prefix), so no data migration is required. When a LINE-only user later
 * completes Shopify OAuth, the callback route is responsible for merging
 * `users/line:<id>/*` into `users/<shopifyNumericId>/*`.
 *
 * ## 連携済みの LINE セッションは Shopify 顧客の棚に解決する（分裂の修正）
 *
 * 上の 2 つの名前空間が交わらないこと自体は設計どおりだが、**連携台帳を一切
 * 見ていなかった**のが「連携したはずなのにログイン手段ごとに別のマイページが
 * 見える」の根因。よって LINE セッションのときは、cx-agent の連携台帳
 * （既存 `GET /api/identity/linkage-status` の逆引き）に問い合わせ、
 * **検証済みの連携があればその Shopify 顧客の棚に解決する**。
 *
 * 判断の倒し方（安全側は常に「自分の棚」）:
 *   - 連携あり   … `userKey = shopifyCustomerId`・`provider = "shopify"`
 *   - 連携なし   … 従来どおり `userKey = "line:<id>"`（＝解除後もここに戻る）
 *   - 読めない   … 従来どおり `userKey = "line:<id>"`。**顧客 ID を推測しない**
 *
 * 「読めない」を連携済みに倒さないのは、外れた推測が他人のお気に入り・行動ログを
 * 見せる事故に直結するから。逆に自分の棚に倒れても失うのは一時的な利便だけで、
 * cx-agent が復旧すれば最大 60 秒（キャッシュ TTL）で正しい棚に戻る。
 *
 * ⚠ `provider` は解決後の棚に合わせて `"shopify"` になるが、これは
 *   **Shopify セッションを持っていることを意味しない**。金額・住所・支払い方法など
 *   Shopify 顧客トークンを要する操作は、この関数ではなく `requireAuth()`
 *   （Shopify セッション専用）で守ること。本関数が守るのは Firestore 上の
 *   お気に入り / フォロー / イベント / 行動ログの棚だけ。
 *
 * ## 1 リクエスト 1 回に畳んである（`React.cache`）
 *
 * この関数は 1 枚の画面から何度も呼ばれる（お気に入り・イベント・行動ログの
 * それぞれが自分で本人解決をする）。中身は `getSession()` と cx-agent への逆引きで、
 * どちらも外向きの往復を含む。リクエスト単位でメモ化しておけば、**同じ描画の中で
 * 同じ答えを何度も取りに行かない**。リクエストの外（テスト・スクリプト）では
 * メモ化されず素通しになるので、呼び出し側の意味は変わらない。
 */
export const resolveIdentity: () => Promise<Identity> = cache(loadIdentity);

async function loadIdentity(): Promise<Identity> {
  try {
    const cookieStore = await cookies();

    // 1) Shopify session takes precedence when present. We reuse `requireAuth`
    //    semantics so Shopify-auth'd users keep the existing `userKey` shape.
    const session = await getSession();
    if (session) {
      const cidEnc = cookieStore.get("shop_cid")?.value;
      if (cidEnc) {
        const customerId = decryptToken(cidEnc);
        if (customerId) {
          return {
            authenticated: true,
            userKey: customerId,
            provider: "shopify",
            displayName: "Customer",
            shopifyCustomerId: customerId,
            lineUserId: null,
          };
        }
      }

      const customer = await getCustomer(session.accessToken);
      if (customer) {
        const customerId = extractCustomerId(customer.id);
        const displayName =
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          "Anonymous";
        return {
          authenticated: true,
          userKey: customerId,
          provider: "shopify",
          displayName,
          shopifyCustomerId: customerId,
          lineUserId: null,
        };
      }
      // Shopify session present but customer fetch failed — fall through to LINE.
    }

    // 2) LINE session fallback.
    //    「LINE セッションの本人が誰か」の判定は lib/line/session.ts に 1 本化して
    //    ある（cookie 2 本の組み合わせと復号を、ここと API route で別々に書かない）。
    {
      const lineUserId = readVerifiedLineUserIdFrom(cookieStore);
      if (lineUserId) {
        let displayName = "LINE User";
        const lineUserCookie = cookieStore.get("line_user")?.value;
        if (lineUserCookie) {
          try {
            const parsed = JSON.parse(lineUserCookie);
            if (typeof parsed?.displayName === "string" && parsed.displayName) {
              displayName = parsed.displayName;
            }
          } catch {
            // Ignore malformed cookie — keep default display name.
          }
        }
        /* 連携台帳を引く。`lineUserId` は暗号化 cookie の復号結果＝サーバ確定値で、
           ブラウザ自己申告ではない（自己申告を渡すと他人の棚を開けられる）。 */
        const linkedCustomerId =
          await fetchShopifyCustomerIdForLineUser(lineUserId);

        if (typeof linkedCustomerId === "string") {
          /* 連携済み: メールでログインしたときと同じ棚を返す。
           *
           * 台帳が返す顧客 ID の形は保証されていない (cx-agent 側の書き込み経路に
           * よって GID `gid://shopify/Customer/123` と数値 `123` の両方がありうる)。
           * 一方メールログイン経路の棚のキーは、`shop_cid` も Customer API 経路も
           * `extractCustomerId` を通した**数値**で確定している
           * (`lib/shopify/id-token.ts` / 上の Shopify 分岐)。
           *
           * ここで正規化を挟まないと、同じ人が「LINE で入ったとき」だけ
           * `users/gid://shopify/Customer/123` という別の棚を持ち、
           * **直したはずの棚の分裂がそのまま再発する**。比較 (identity-link.ts の
           * 本人一致判定) と同じ正規化を、棚のキーにも通す。 */
          const customerId = extractCustomerId(linkedCustomerId);
          return {
            authenticated: true,
            userKey: customerId,
            provider: "shopify",
            displayName,
            shopifyCustomerId: customerId,
            lineUserId,
          };
        }

        // 未連携（false）/ 読めない（null）はどちらも従来どおり LINE 単独の人格。
        return {
          authenticated: true,
          userKey: `line:${lineUserId}`,
          provider: "line",
          displayName,
          shopifyCustomerId: null,
          lineUserId,
        };
      }
    }

    return { authenticated: false, error: "Not authenticated", status: 401 };
  } catch {
    return { authenticated: false, error: "Authentication failed", status: 401 };
  }
}
