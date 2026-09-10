import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";

import { applyLinkageEstablished } from "@/lib/auth/identity-link";
import { env } from "@/lib/config";
import { extractCustomerId } from "@/lib/firebase/types";
import { logger } from "@/lib/log";

/**
 * 「台帳に連携の行が立った」— **合体が走る唯一のきっかけ**（M-2）。
 *
 * ## なぜこの口が要るのか
 *
 * 連携は 4 つの経路で成立しうる。
 *
 * | 経路 | 台帳を書くのは | web-app を通るか |
 * |---|---|---|
 * | マイページの連携 CTA | web-app → cx-agent | 通る |
 * | LIFF | web-app → cx-agent | 通る |
 * | メールログインの取りこぼし再試行 | （書かない・確認だけ） | 通る |
 * | **LINE トーク内の Account Link** | **cx-agent が単独で** | **通らない** |
 *
 * 最後の 1 つが D-3 の正体である。LINE → cx-agent の webhook だけで完結するので、
 * web-app 側に「合体を始めるきっかけ」が**構造的に存在しなかった**。連携は台帳上
 * 成立しているのに、お気に入りは `users/line:<ID>` に取り残される。
 *
 * 経路ごとに合図を足していく限り、経路が増えるたびに同じ穴が空く。よって合図を
 * **「台帳に行が立った」という 1 イベント**に集約し、書いた側（cx-agent）から
 * ここへ通知させる。以後、経路が何本になっても合体は漏れない。
 *
 * ## なぜ「読み直す」のをやめるのか
 *
 * 従来、連携経路は台帳に書いた**直後**にキャッシュを捨てて HTTP で引き直し、その
 * 3 秒一発が外れたら合体しない、という作りだった。引き直しは「書いた事実」を
 * 確かめ直しているだけで、**書いた側より確かな情報源は無い**。だからここでは
 * 引き直さず、通知の内容をそのまま根拠にする（`applyLinkageEstablished`）。
 *
 * ## 認証
 *
 * `Authorization: Bearer ${LINKAGE_EVENT_SECRET}`。**`SYNC_API_SECRET` とは別鍵**にする。
 * この口は「この LINE とこの顧客は同一人物である」と**宣言できる**口なので、
 * 他の用途で配った鍵で開けられるようにしてはいけない。比較は timing-safe。
 *
 * 未設定なら 503（fail-closed）。鍵が無い状態で素通しにすると、**誰でも他人の棚へ
 * データを移せる**口になる — 合体は元を消す操作なので、間違えても元に戻せない。
 *
 * ## 冪等
 *
 * 合体そのものが冪等（`identity-merge.ts` の 4 段は、運べたものだけを消す）。よって
 * 通知が重複しても、再送されても、増えも壊れもしない。cx-agent 側は失敗時に再送してよい。
 */
export const dynamic = "force-dynamic";

type EventBody = {
  line_user_id?: unknown;
  shopify_customer_id?: unknown;
  source?: unknown;
};

/** 長さの違いも漏らさない定数時間比較。 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // それでも比較は走らせる（早期 return による分岐時間差を作らない）
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = env("LINKAGE_EVENT_SECRET");
  if (!expected) {
    /* 503 であって 500 ではない。壊れているのではなく、このデプロイでは
       設定されていない（プレビュー等）。素通しには**しない**。 */
    console.error(
      "[linkage-event] LINKAGE_EVENT_SECRET is not set; refusing to merge",
    );
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !secretsMatch(provided, expected)) {
    console.warn("[linkage-event] rejected: bad credential");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: EventBody;
  try {
    body = (await request.json()) as EventBody;
  } catch (err) {
    /* 鍵は既に通っている = cx-agent からの通知である。その body が読めないのは
       送り手側の不具合で、放っておくと連携が黙って合体しないまま残る。 */
    logger.error("api.linkage-established.body-parse-failed", err, {
      route: "/api/internal/linkage-established",
      status: 400,
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const lineUserId =
    typeof body.line_user_id === "string" ? body.line_user_id.trim() : "";
  const rawCustomerId =
    typeof body.shopify_customer_id === "string"
      ? body.shopify_customer_id.trim()
      : typeof body.shopify_customer_id === "number"
        ? String(body.shopify_customer_id)
        : "";

  if (!lineUserId || !rawCustomerId) {
    return NextResponse.json({ error: "missing_identifier" }, { status: 400 });
  }

  /* 顧客 ID の形（GID か数値か）は cx-agent 側の書き込み経路で揺れうる。棚のキーは
     数値で確定しているので、ここで必ず正規化する。揺れたまま合体すると
     `users/gid://shopify/Customer/123` という別の棚ができ、直したはずの棚の分裂が
     そのまま再発する。 */
  const shopifyCustomerId = extractCustomerId(rawCustomerId);
  if (!shopifyCustomerId) {
    return NextResponse.json({ error: "bad_customer_id" }, { status: 400 });
  }

  const upstreamSource =
    typeof body.source === "string" ? body.source.slice(0, 40) : "unknown";

  const result = await applyLinkageEstablished({
    lineUserId,
    shopifyCustomerId,
    source: "linkage-event",
  });

  if (result.outcome !== "merged") {
    /* ⚠ 識別子はログに載せない（`upstreamSource` だけで発生箇所は特定できる）。
       合体できなかったことは残す — ここが無音だと D-3 が別の形で復活する。 */
    console.error(
      `[linkage-event] merge did not complete (outcome=${result.outcome}, upstream=${upstreamSource})`,
    );
    Sentry.captureMessage("Linkage event did not merge", {
      level: "error",
      tags: {
        subsystem: "linkage-event",
        outcome: result.outcome,
        upstream: upstreamSource,
      },
    });
    /* 5xx を返して cx-agent 側に再送させる。合体は冪等なので再送に害は無く、
       ここで 200 を返すと「連携したのに合体しない」が静かに残る。 */
    return NextResponse.json(
      { ok: false, outcome: result.outcome },
      { status: 500 },
    );
  }

  console.log(
    `[linkage-event] merged (upstream=${upstreamSource}, moved=${result.merge?.totals.copied ?? 0}, retained=${result.merge?.retained ?? 0})`,
  );
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
