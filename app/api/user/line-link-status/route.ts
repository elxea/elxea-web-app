import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { logger } from "@/lib/log";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { fetchLineLinkageStatus } from "@/lib/line/linkage-status";

/**
 * GET /api/user/line-link-status
 *
 * P1（マイページに LINE 連携状態を表示）の読み取り口。ログイン中の本人が
 * 「自分が LINE と連携しているか」を引くためだけのエンドポイント。
 *
 * ## 誰の状態を返すか（QA 要件 1）
 *
 * 顧客 ID は **サーバ認証済み Shopify セッション**（`requireAuth`）から確定する。
 * クエリ・ボディ・ヘッダーから顧客 ID を **一切受け取らない**。受け取れる形にすると
 * 「他人の顧客 ID を指定して連携状態を覗く」経路になる（誰が LINE を使っているかは
 * それ自体が知られたくない情報）。パラメータを足したくなったらまずここを読むこと。
 *
 * ## 何を返すか（QA 要件 3）
 *
 * 連携の有無と、いつからかだけ。**LINE の ID は返さない**（cx-agent も返さない）。
 *
 * ## スコープ（QA 要件 4）
 *
 * 状態の**表示**のみ。解除は扱わない（解除の状態遷移が未確定のため P1b）。
 * このファイルに DELETE / POST を足さないこと。
 *
 * 応答:
 *   200 { linked: true,  linkedAt: string }  … 連携済み
 *   200 { linked: false, linkedAt: null }    … 未連携
 *   200 { linked: null,  linkedAt: null }    … 不明（cx-agent 不達等・fail-soft）
 *   401 { error: "unauthorized" }            … 未ログイン
 *
 * 「不明」を 5xx にしない理由: マイページはこの結果で描画を出し分けるだけで、
 * 読めなかったときは連携ボタンを出す従来どおりの表示に戻ればよい。連携状態が
 * 読めないことでページ全体を落とさない。
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Shopify セッション認証。顧客 ID はここでだけ確定する（自己申告は受けない）。
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    // 2. cx-agent の記録簿へ server-to-server で問い合わせ（never throw / fail-soft）。
    const status = await fetchLineLinkageStatus(auth.customerId);

    return NextResponse.json(status);
  } catch (err) {
    /* ここに来るのは requireAuth 自体が壊れた場合。連携状態は不明として返し、
       画面を落とさない。ただし応答が 200「不明」で外からは平常時と見分けが
       つかないので、認証が壊れている事実は必ず鳴る側に載せる。 */
    logger.error("api.line-link-status.read-failed", err, {
      route: "GET /api/user/line-link-status",
    });
    return NextResponse.json({ linked: null, linkedAt: null });
  }
}
