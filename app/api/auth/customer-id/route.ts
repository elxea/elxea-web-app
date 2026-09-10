/**
 * GET /api/auth/customer-id
 *
 * Returns the Shopify Customer ID for the currently logged-in user.
 * Used by the chat transport to identify authenticated users when
 * communicating with the cx-agent API.
 *
 * Response:
 *   - 200 { customer_id: string }  — logged in
 *   - 200 { customer_id: null }    — **確定的に**未ログイン
 *   - 503 { customer_id: null, error: "session_unavailable" }
 *                                  — 判定できなかった (Shopify 側の問題)
 *
 * ## なぜ「判定できなかった」を 200 で返さないか (設計憲章 R1)
 *
 * 以前はどちらも `200 { customer_id: null }` だった。呼び出し側 (チャットの
 * トランスポート) はこれを「未ログインの人」として扱うので、Shopify が詰まった
 * 瞬間だけログイン中の顧客が**匿名ユーザーとして cx-agent に渡る**。会話が
 * 顧客に紐付かず、本人には何も起きていないように見える。
 *
 * 503 なら呼び出し側は「今は分からない」と扱える (再試行できる)。未ログインの
 * 200 と混ざらないので、監視でも切り分けられる。
 */
import { NextResponse } from "next/server";
import { getCustomerFromSession } from "@/lib/shopify/auth";

export async function GET() {
  const result = await getCustomerFromSession();

  if (!result.ok) {
    /* 記録は `getCustomerFromSession` 側で済んでいる (Sentry)。ここでは
       顧客側に「未ログイン」と誤って伝えないことだけを担保する。 */
    return NextResponse.json(
      { customer_id: null, error: "session_unavailable" },
      { status: 503 },
    );
  }

  return NextResponse.json({ customer_id: result.data?.id ?? null });
}
