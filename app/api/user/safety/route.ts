/**
 * POST /api/user/safety — 「避けたいもの」の申告を受ける（第1段 ⑥）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ⑥ /
 * §2「絶対に越えない線」/ §4「どのオフを選んでも、安全申告は絶対に効き続ける」。
 *
 * ## 受け口は既にあった。無かったのは画面だけ
 *
 * L0 の `safety.declared` と、それを畳む L1 の枝は cx-agent 側に実装済み
 * （`event-vocabulary.ts` / migration 051）。設計 §6 の ⑥ が「受け口は実装済み、
 * 画面だけ無い」と書いているのはこのこと。ここはその画面から L0 への 1 本である。
 *
 * ## 閉じた語彙しか受けない（自由文は受け口の形として存在しない）
 *
 * 受けるのは `SAFETY_TAGS` の 3 値だけ。病名・服薬・通院は**要配慮個人情報**で、
 * 取得も保存もしない（設計 §2 の禁止表 / LINE 公式アカウント API 利用規約 第5条）。
 * 自由記入をここに開けると、書かれた瞬間に禁止の側に落ちる。だから
 * `SafetyDeclarationBodySchema` に自由文の項目が無い（気をつけるのではなく、
 * 入れる場所を作らない）。設計 §2 の表が挙げる「自由記入」は、読み手のいる経路
 * （お問い合わせ）に寄せてあり、画面がそこへ案内する。
 *
 * ## 明示同意が無い申告は受けない
 *
 * 妊娠は病歴ではないが**要配慮相当**として扱う（設計 §2 の判定列）。schema が
 * `consent: true` を必須にしているので、同意の無い body は 400 で落ちる。
 *
 * ## 足す方向にしか動かない
 *
 * cx-agent の L1 は `safety.declared` を「減らす方向に畳まない」。解除を表す
 * 出来事（`safety.cleared`）はまだ語彙に無いので、この口も**追加専用**にしてある。
 * 画面にも「取り消しはお問い合わせから」と正確に書く（止まる範囲を曖昧にしない・
 * 設計 §4）。解除経路は第2段で語彙ごと足す。
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import { toSafetyGatewayEvent } from "@/lib/cdp/cup-feedback";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { addSafetyTags, getSafetyDeclaration } from "@/lib/firebase/profile-store";
import { logger } from "@/lib/log";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { SafetyDeclarationBodySchema } from "@/lib/validation/profile-schema";
import { parseJsonBody } from "@/lib/validation/zod-helpers";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, SafetyDeclarationBodySchema);
    if (!parsed.ok) {
      console.warn("[POST /api/user/safety] rejected payload (schema drift?)");
      return parsed.response;
    }

    const occurredAt = new Date().toISOString();
    const subject = resolveBehaviorSubject(
      auth,
      undefined,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );
    if (subject.kind === null) {
      logger.error(
        "api.safety.subject-unresolved",
        new Error("authenticated caller has no usable identifier"),
        { route: "POST /api/user/safety", reason: subject.reason },
      );
      return NextResponse.json({ error: "subject_unresolved" }, { status: 409 });
    }

    /* すでに申告済みの分を除いてから積む。同じ内容を積み直しても L1 は同じに
       なるが、出来事としては「同じことをもう一度言った」が増えるだけなので、
       増えた分だけを 1 件にまとめる。 */
    const before = await getSafetyDeclaration(auth.userKey);
    const added = parsed.data.tags.filter((tag) => !before.tags.includes(tag));
    if (added.length === 0) {
      return NextResponse.json({ recorded: true, added: [], tags: before.tags });
    }

    const stored = await sendToEventsGateway([
      toSafetyGatewayEvent(subject, added, occurredAt),
    ]);
    if (!stored) {
      /* 積めていない申告を「登録済み」と見せない。安全に関わるので、ここだけは
         画面に成功を返さない（届かなかったことは gateway 側が残している）。 */
      return NextResponse.json({ error: "not_recorded" }, { status: 503 });
    }

    const result = await addSafetyTags(auth.userKey, added);
    return NextResponse.json({ recorded: true, added: result.added, tags: result.tags });
  } catch (err) {
    logger.error("api.safety.submit-failed", err, { route: "POST /api/user/safety" });
    return NextResponse.json({ error: "safety_failed" }, { status: 500 });
  }
}
