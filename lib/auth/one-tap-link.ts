/**
 * ワンタップ連携で、実際に台帳へ行を立てる（J-1 案A）。
 *
 * 呼ばれるのは `/api/auth/callback` の中、**意思の封筒が開けたときだけ**
 * （`lib/auth/link-intent.ts` の `openLinkIntent` が `ok` を返したとき）。
 *
 * ## なぜここで台帳を書けるのか
 *
 * 従来この経路は「台帳に**書かない**」経路だった。理由はまっとうで、
 * 「`line_uid` cookie が同居しているだけ」を理由に連携行を作ると、B5 の事故
 * （共用端末で他人のデータを持ち去る）を**台帳側にも広げる**ことになるからである。
 *
 * 封筒はその「同居」ではない。押した瞬間にしか作られず、押した人の LINE にしか
 * 使えず、一度使えば消える — 連携は本人が意思をもって押す操作で、封筒はその意思の
 * 記録そのものである。だから封筒が開けたときに限り、書いてよい。
 *
 * ## なぜ M-0 の後でしかできないのか
 *
 * ここで台帳に書く LINE ID は `line_uid` cookie 由来、つまり **LINE Login チャネル**
 * から来た userId である。台帳が持つのは Messaging チャネルの userId。両者が別
 * プロバイダにある限り、**同じ人でも番号が違う**ので、書いても永久に引けない行が
 * 増えるだけだった。
 *
 * M-0 で本番 OA と同一プロバイダの Login チャネル（2011239425）へ切り替えたので、
 * この 2 つは同じ値になった。ワンタップが成立するのはその前提の上である。
 */
import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/config";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import type { LinkageCompletion } from "@/lib/auth/identity-link";
import type { LinkResult } from "@/lib/line/link-flow";
import {
  isLedgerAuthRejection,
  reportLedgerAuthFailure,
} from "@/lib/line/ledger-auth";

/** 何が起きたか。**決して throw しない**（ログインを失敗させない）。 */
export type OneTapLinkResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * - `not-configured` … cx-agent を呼ぶ鍵が無い
       * - `conflict`       … その顧客には既に別の LINE が連携済み（1 対 1・J-4）
       * - `unreachable`    … cx-agent に届かない
       * - `rejected`       … cx-agent が拒んだ（4xx / 5xx）
       */
      reason: "not-configured" | "conflict" | "unreachable" | "rejected";
      detail: string;
    };

/** cx-agent の応答を待つ上限。ログインの帰り道なので長く待たせない。 */
const TIMEOUT_MS = 5000;

/**
 * 台帳に「この LINE ↔ この顧客」の行を立てる。
 *
 * @param lineUserId **封筒から取り出し、いまの `line_uid` と束縛が取れた**値のみ。
 * @param shopifyCustomerId **サーバ確定**の Shopify 顧客 ID。
 */
export async function establishLinkageFromIntent({
  lineUserId,
  shopifyCustomerId,
  fetchImpl = fetch,
}: {
  lineUserId: string;
  shopifyCustomerId: string;
  fetchImpl?: typeof fetch;
}): Promise<OneTapLinkResult> {
  const secret = env("SYNC_API_SECRET");
  if (!secret) {
    /* fail-closed。鍵が無ければ cx-agent は 401 を返すので、無駄打ちもしない。
       ワンタップが成立しないだけで、ログインも既存の連携も壊れない。
       ただし「誰もワンタップできない」状態なので、監視には上げる。 */
    console.error("[one-tap-link] SYNC_API_SECRET not set; cannot write linkage");
    reportLedgerAuthFailure({ source: "one-tap-link", failure: "secret-missing" });
    return { ok: false, reason: "not-configured", detail: "SYNC_API_SECRET missing" };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${CX_AGENT_BASE_URL}/api/identity/link-liff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": secret },
      body: JSON.stringify({
        line_messaging_user_id: lineUserId,
        shopify_customer_id: shopifyCustomerId,
        /* email はここでは分からない（LINE ログイン経路で email scope は未承認）。
           null で既存値を消さないのは cx-agent 側の upsert の責任範囲。 */
        shopify_email: null,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(
      "[one-tap-link] cx-agent unreachable:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      ok: false,
      reason: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 409) {
    /* その顧客には既に別の LINE が連携済み。**恒久的な衝突**であって障害ではない
       （J-4: 世帯共有は認めない）。ログインは成立させたまま、事実だけ残す。 */
    console.warn("[one-tap-link] customer already linked to another LINE (409)");
    return { ok: false, reason: "conflict", detail: "shopify_customer_already_linked" };
  }

  if (!res.ok) {
    console.error(`[one-tap-link] cx-agent rejected the linkage (status=${res.status})`);
    /* 401 は「拒まれた 1 件」ではなく「共有鍵がずれていて全員が連携できない」。
       同じ `rejected` に畳んだままだと、通知を見た人が個別の失敗として流してしまう
       （2026-08-30 に実際そうなった）。設定破壊の通知を別に出す。 */
    if (isLedgerAuthRejection(res.status)) {
      reportLedgerAuthFailure({ source: "one-tap-link", failure: "key-rejected" });
    } else {
      Sentry.captureMessage("One-tap link rejected by cx-agent", {
        level: "error",
        tags: { subsystem: "one-tap-link", status: String(res.status) },
      });
    }
    return { ok: false, reason: "rejected", detail: `status=${res.status}` };
  }

  console.log("[one-tap-link] linkage established from intent");
  return { ok: true };
}

/**
 * ワンタップの結果を、**画面に出す 1 語**へ畳む（F1）。
 *
 * ## なぜこれが要るのか
 *
 * ワンタップ連携（J-1 案A）は、押した人を Shopify のログインへ送り出し、戻ってきた
 * `/api/auth/callback` で台帳に行を立てる。ところがその戻り先は**何も表示していなかった**。
 * 成功しても、恒久的な衝突で断られても、画面はただのマイページに戻るだけ。
 *
 * 押した人から見ると、成功も失敗も「押したのに何も起きなかった」と同じ形になる。
 * これは J-1 案A が直そうとしていた体験（§1-2「押しても定義上 100% 何も起きない」）を、
 * **別の経路で作り直している**。#128 が他の 3 経路に入れた明示表示と同じ品質を、
 * この経路にも持たせる。
 *
 * ## 衝突の向きを、手元にある証拠だけで見分ける
 *
 * cx-agent は 1 対 1 固定に反する書き込みを 409 で断る。409 そのものは**どちら側が
 * ぶつかったか**を言わない。しかしこの経路は、書き込みのあとに台帳を引き直す
 * （`completeLineLinkage`）ところまで通る。その引き直しが `linked-elsewhere` を返したなら、
 * **この LINE に別の顧客が付いている**ことが台帳の側から確定する。
 *
 * 分からないときに推測しない、という原則はここでも同じ。証拠が無ければ
 * `conflict`（＝このメールアドレス側の衝突）に倒す。cx-agent の 409 が現に返している
 * のは `shopify_customer_already_linked` だけなので、これは既定として正しい。
 *
 * ## 連携の成否と、合体の成否を混ぜない
 *
 * 台帳への書き込みが成立したなら、**連携は完了している**。そのあとの合体
 * （お気に入りの引っ越し）が半端に終わっても、それは次のログインで拾い直される
 * 取りこぼしであって、「連携できませんでした」ではない。よって `outcome.ok` は
 * `success` に写す。合体の失敗は Sentry とログの担当で、画面の担当ではない。
 *
 * @param outcome 台帳への書き込みの結果。`null` は「呼ぶ前に諦めた」。
 * @param completion 書き込み後の合体の結果（`null` は走らせていない）。
 */
export function resolveOneTapResult(
  outcome: OneTapLinkResult | null,
  completion: LinkageCompletion | null,
): LinkResult {
  /* 台帳が「この LINE は別の顧客のもの」と言っている。409 の向きを決めるのは
     この 1 点だけで、これが出た時点で他の理由より優先する。 */
  const lineTakenByAnother = completion?.outcome === "linked-elsewhere";

  if (!outcome) return lineTakenByAnother ? "line-conflict" : "error";
  if (outcome.ok) return lineTakenByAnother ? "line-conflict" : "success";
  if (outcome.reason === "conflict") {
    return lineTakenByAnother ? "line-conflict" : "conflict";
  }
  /* `not-configured` / `unreachable` / `rejected`。いずれも**やり直せば直りうる**
     （鍵の投入・cx-agent の復旧）。恒久的な衝突と混ぜない。 */
  return "error";
}
