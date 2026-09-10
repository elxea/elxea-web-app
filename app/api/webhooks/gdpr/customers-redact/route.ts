import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { FieldValue } from "firebase-admin/firestore";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";
import { eraseInCxAgent } from "@/lib/erase/cx-agent";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/log";
import {
  userDoc,
  userSubcollection,
  USER_SUBCOLLECTIONS,
} from "@/lib/firebase/collections";

/**
 * Firestore の WriteBatch が 1 コミットで受け付ける書き込みの上限。
 *
 * これは実装都合の定数ではなく **Firestore 側の固定上限**で、501 件目を積んだ
 * batch は `commit()` が `INVALID_ARGUMENT` で落ちる。
 */
const FIRESTORE_BATCH_LIMIT = 500;

/**
 * 配列を最大 `size` 件ずつに切り分ける。
 *
 * ## なぜ切るのか — 「一番消さなければいけない人」だけが消せなかった
 *
 * 以前の実装はサブコレクションの全ドキュメントを **1 つの `db.batch()` に
 * 積んで 1 回だけ commit** していた。関数の説明には「in batches (複数回に
 * 分けて)」と書いてあったのに、実装は 1 バッチしか作っていない。説明と実装が
 * 食い違ったまま、テストは空コレクション (0 件) しか通していなかったので
 * 誰も気づかなかった。
 *
 * この壊れ方の悪質なところは、**当たる人が偏る**ことにある。落ちるのは
 * `behaviorLog` が 500 件を超えるお客さま — つまり LINE と EC を長く使い、
 * 最も多くの個人データが溜まっている人である。ライトユーザーの削除要求は
 * 通り、ヘビーユーザーの削除要求だけが 500 で弾かれる。GDPR 上いちばん
 * 実害が大きい側だけが消えないという、静かで偏った失敗になっていた。
 *
 * さらに commit の失敗は例外として上がるので 5xx にはなるが、Shopify が
 * 何度再送しても件数は減らない (毎回同じ 500 超えで落ちる)。再送では
 * 永久に直らない。
 *
 * よって上限件数ごとに切って **順番に** commit する。並列にしないのは、
 * 同一コレクションへの大量書き込みを一度に投げると Firestore 側の競合で
 * 中途半端に失敗しうるため。順次なら「どこまで消えたか」が単調に進み、
 * 途中で落ちても再送でその続きから消える (削除は冪等)。
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Delete all documents in a Firestore subcollection.
 *
 * Firestore does not support deleting subcollections atomically, so we fetch
 * all docs and delete them in batches of at most `FIRESTORE_BATCH_LIMIT`
 * writes, committed one after another. Returns the number of deleted docs.
 */
async function deleteSubcollection(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
): Promise<number> {
  const snapshot = await db.collection(collectionPath).get();
  if (snapshot.empty) return 0;

  for (const docs of chunk(snapshot.docs, FIRESTORE_BATCH_LIMIT)) {
    const batch = db.batch();
    for (const doc of docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
  return snapshot.size;
}

/**
 * Shopify GDPR: customers/redact webhook handler.
 *
 * Shopify sends this when a customer requests deletion of their data.
 * elxea stores customer data in Firestore under users/{customerId}, including
 * every subcollection listed in `USER_SUBCOLLECTIONS`
 * (`lib/firebase/collections.ts`). All must be deleted. 対象一覧をここに
 * 書き写さないのは、書き写した瞬間に台帳と二重管理になり、片方だけ増えて
 * 消し残しが出るため。
 *
 * ## 消える範囲は Firestore だけではない（M-5 / Issue A・2026-08-25）
 *
 * 本人のデータは 2 か所にある。Firestore（web-app の持ち物）と、Supabase の連携台帳・
 * 会話履歴・カルテ（cx-agent の持ち物）である。後者は **cx-agent の worker からしか
 * 触れない**ので、cx-agent 側に `POST /api/erase` が用意され、コードにもこう書いてある —
 * 「web-app 側の `customers/redact` はここを呼ぶだけにして、『何が消える範囲か』の定義を
 * 1 か所に集約する」。
 *
 * **その呼び出しが一度も書かれていなかった。** 結果、削除要求に対して Firestore だけを
 * 消して 200 を返し、Supabase 側は丸ごと残ったまま「消しました」と答えていた。
 *
 * ## 順番 — cx-agent を先に呼ぶ
 *
 * Firestore を先に消すと、cx-agent 側が落ちたときに **Firestore だけ消えた中途半端な状態**が
 * 残り、しかも再送で cx-agent が消えても Firestore の消去は既に済んでいるので、
 * 「どこまで消えたか」が経路から読めなくなる。cx-agent を先に通しておけば、失敗した
 * 時点では**何も消えていない**か、**cx-agent 側だけ消えている**かのどちらかで、
 * どちらも再送で前に進む（両側とも冪等）。
 *
 * ## 消えなかったら 200 を返さない
 *
 * G10（成功偽装をしない）。cx-agent が消し残しを検出したら 5xx を返し、Shopify に
 * 再送させる。冪等なので再送で害は無く、放置すると GDPR 上の実害だけが残る。
 * 例外は「鍵が無い / 鍵が違う」— これは再送しても直らないので、鳴らしたうえで
 * 再送を促さない（詳細は `lib/erase/cx-agent.ts` の `retryable`）。
 */
export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;
  const body = payload as {
    customer?: { id?: number };
    shop_domain?: string;
  };

  console.log(
    `[Webhook:GDPR] Received ${topic}: customers/redact (customerId=${body.customer?.id ?? "unknown"})`,
  );

  const shopifyCustomerId = body.customer?.id;
  if (!shopifyCustomerId) {
    console.warn("[Webhook:GDPR] customers/redact: no customer.id in payload");
    return NextResponse.json({ received: true });
  }

  const customerId = String(shopifyCustomerId);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  try {
    const db = getAdminFirestore();

    // Idempotency: if we have a webhook id, check whether this delivery has
    // already been processed. Shopify may retry GDPR redact webhooks on 5xx
    // or network errors, and we must not double-delete or race with another
    // delivery.
    if (webhookId) {
      const logRef = db.collection("_webhookLogs").doc(webhookId);
      const existing = await logRef.get();
      if (existing.exists) {
        console.log(
          `[Webhook:GDPR] customers/redact already processed (webhookId=${webhookId}), returning 200`,
        );
        return NextResponse.json({ received: true, idempotent: true });
      }
    } else {
      console.warn(
        "[Webhook:GDPR] customers/redact missing x-shopify-webhook-id header; idempotency not enforced",
      );
    }

    /* cx-agent 側（Supabase の台帳・会話履歴・カルテ）を先に消す。順番の理由は
       ファイル冒頭の注記のとおり。202 が返る間は消しきるまで呼び直す —
       202 は 2xx だが**完了ではない**。 */
    const cxErase = await eraseInCxAgent({ kind: "shopify", id: customerId });
    if (!cxErase.ok) {
      /* ⚠ 顧客 ID はログに載せない（削除要求の対象を痕跡として残さないため）。
         切り分けに要るのは reason と試行回数だけで、それで足りる。 */
      console.error(
        `[Webhook:GDPR] customers/redact aborted — cx-agent erase failed (reason=${cxErase.reason}, attempts=${cxErase.attempts}): ${cxErase.detail}`,
      );
      Sentry.captureMessage("GDPR redact: cx-agent erase failed", {
        level: "error",
        tags: {
          subsystem: "gdpr-redact",
          reason: cxErase.reason,
          retryable: String(cxErase.retryable),
        },
        extra: { attempts: cxErase.attempts, detail: cxErase.detail },
      });

      /* 冪等ログは**書かない**。書くと再送が「処理済み」で弾かれ、消えていない
         まま二度と消えなくなる。 */
      return NextResponse.json(
        { error: "cx-agent erase failed", reason: cxErase.reason },
        { status: cxErase.retryable ? 503 : 500 },
      );
    }
    console.log(
      `[Webhook:GDPR] cx-agent erase completed (attempts=${cxErase.attempts})`,
    );

    /* 消す対象は **台帳 (`USER_SUBCOLLECTIONS`) から導出する**。ここに 6 個の
       コレクション名を手で並べていたときは、`COLLECTIONS` に新しいサブ
       コレクションを足しても削除側は誰も直さず、その分だけ「消したはずの人の
       データ」が黙って残り続ける形になっていた (識別子の合体で同じ取り残しが
       実際に起きている。`lib/firebase/collections.ts` の注記を参照)。

       台帳から引けば、足した時点で自動的に削除対象に入る。逆に「対象外」に
       したいものは `NON_USER_COLLECTIONS` 側に申告する必要があり、
       `__tests__/firestore-collection-coverage.test.ts` がどちらにも入って
       いないコレクションで落ちる。 */
    const subcollections = USER_SUBCOLLECTIONS.map((sub) =>
      userSubcollection(customerId, sub),
    );

    const results = await Promise.allSettled(
      subcollections.map((col) => deleteSubcollection(db, col)),
    );

    // Track any subcollection deletion failures. We must NOT return 200 if
    // any deletion failed — that would silently drop a GDPR request and
    // leave orphan customer data.
    const failedSubcollections: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        console.log(
          `[Webhook:GDPR] Deleted ${result.value} docs from ${subcollections[i]}`,
        );
      } else {
        console.error(
          `[Webhook:GDPR] Failed to delete ${subcollections[i]}:`,
          result.reason,
        );
        failedSubcollections.push(subcollections[i]!);
      }
    }

    if (failedSubcollections.length > 0) {
      // Return 500 so Shopify retries. We intentionally do NOT write the
      // idempotency log doc, so the retry will re-enter the try block.
      console.error(
        `[Webhook:GDPR] Aborting — subcollection deletion failures:`,
        failedSubcollections,
      );
      return NextResponse.json(
        { error: "Partial deletion failure" },
        { status: 500 },
      );
    }

    // Delete the user document itself. Failure here must also surface as 5xx
    // so Shopify retries and the customer's root user doc is not orphaned.
    try {
      await db.doc(userDoc(customerId)).delete();
      console.log(
        `[Webhook:GDPR] Deleted user document: ${userDoc(customerId)}`,
      );
    } catch (userDocErr) {
      /* 子は消えたのに本人の文書だけ残る = 消し残り。法令上の義務なので、
         Shopify の再送に任せきりにせず人が気づける側にも載せる。 */
      logger.error("api.gdpr-customers-redact.user-doc-delete-failed", userDocErr, {
        customerId,
        shopDomain: body.shop_domain,
        status: 500,
      });
      return NextResponse.json(
        { error: "User document deletion failed" },
        { status: 500 },
      );
    }

    // Record successful processing for idempotency. Only reached when all
    // deletions succeeded.
    if (webhookId) {
      const { Timestamp } = await import("firebase-admin/firestore");
      await db.collection("_webhookLogs").doc(webhookId).set({
        topic,
        source: "shopify",
        kind: "customers/redact",
        customerId,
        processedAt: FieldValue.serverTimestamp(),
        // TTL: 7 days. Dedup log is GC'd by Firestore TTL policy.
        ttl: Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ),
      });
    }
  } catch (error) {
    /* Unhandled error — return 500 so Shopify retries. Previous behavior
       returned 200 which silently dropped GDPR requests.
       再送は Shopify 任せなので、再送も尽きたまま消えていない状態に
       誰も気づけない事態を避けるため、ここは必ず鳴らす。
       webhook の本文は個人情報なので載せない。 */
    logger.error("api.gdpr-customers-redact.erase-failed", error, {
      customerId,
      shopDomain: body.shop_domain,
      status: 500,
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
