/**
 * 行動ログ 1 件を events gateway の形に写す（純粋・CDP 統合 Stage 1）。
 *
 * ここを route から出してあるのは、**同意の判定と識別子の選び方を単体で試せる**
 * ようにするため。route の中に置くと、テストが Next の認証・cookie ごと持ち上げる
 * ことになり、いちばん間違えやすい 2 つ（同意していない人を通していないか／
 * 誰の出来事として積むか）が確かめにくくなる。
 *
 * 契約（payload の形・冪等キー・語彙）の正本は cx-agent 側の
 * `docs/cdp-events-gateway-contract.md`。ここは写す側であって、契約は持たない。
 */

import type { GatewayEvent } from "@/lib/cdp/events-gateway-client";
import { isAnalyticsAllowed, normalizeConsentValue } from "@/lib/consent";

/** どの識別子で L0 に積むかの判定結果。 */
export type BehaviorSubjectRef =
  | { kind: "shopify_customer_id" | "line_login_uid" | "web_anonymous_id"; value: string }
  | { kind: null; reason: BehaviorSkipReason };

export type BehaviorSkipReason =
  | "anonymous_without_consent"
  | "anonymous_id_missing"
  | "identity_unresolved";

/** ログイン済みの人の身元（`resolveIdentity()` の結果から必要な分だけ）。 */
export interface BehaviorIdentity {
  authenticated: boolean;
  shopifyCustomerId?: string | null;
  lineUserId?: string | null;
}

/**
 * 誰の出来事として積むかを決める。
 *
 * 匿名の人は **解析の同意がサーバ側の cookie でも取れているときだけ** 通す。
 * 送り手（ブラウザ）も同じ判定をしているが、送り手の判定はブラウザ側の状態に
 * すぎない — 通す/通さないの最終判断はサーバが持つ（fail-closed の二重ゲート）。
 *
 * @param consentCookie `cookie_consent` の生の値（未設定なら null）
 */
export function resolveBehaviorSubject(
  identity: BehaviorIdentity,
  anonymousId: string | undefined,
  consentCookie: string | null,
): BehaviorSubjectRef {
  if (identity.authenticated) {
    /* Shopify の顧客番号を優先する（連携済みならこちらが本カルテの鍵と一致する）。
       LINE ログインだけの人は LINE Login の sub で積む — Messaging API の userId
       とは別物なので、edge の種類も別にしてある（J-0 非依存）。 */
    if (identity.shopifyCustomerId) {
      return { kind: "shopify_customer_id", value: identity.shopifyCustomerId };
    }
    if (identity.lineUserId) {
      return { kind: "line_login_uid", value: identity.lineUserId };
    }
    return { kind: null, reason: "identity_unresolved" };
  }

  if (!isAnalyticsAllowed(normalizeConsentValue(consentCookie))) {
    return { kind: null, reason: "anonymous_without_consent" };
  }
  if (!anonymousId) {
    return { kind: null, reason: "anonymous_id_missing" };
  }
  return { kind: "web_anonymous_id", value: anonymousId };
}

/**
 * 行動ログ 1 件を gateway の 1 イベントに写す。
 *
 * `dedupe` に時刻を含めるのは、同じ記事を何度見るのも別の出来事だから。
 * `occurredAt` は呼び出し側で **1 回だけ** 決めた値を渡すこと（2 回計算すると
 * 別の鍵になり、再送で 2 行になる）。
 */
export function toBehaviorGatewayEvent(
  subject: Extract<BehaviorSubjectRef, { kind: string }>,
  action: string,
  metadata: { contentId?: string; productId?: string; durationSeconds?: number },
  occurredAt: string,
): GatewayEvent {
  const anchor = metadata.contentId ?? metadata.productId ?? "-";
  return {
    event_type: `behavior.${action}`,
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `${anchor}@${occurredAt}`,
    source: "web-app.behavior",
    occurred_at: occurredAt,
    /* 自由文（query / buttonLabel）は載せない。載せるのは ID 相当と数値だけ。 */
    payload: {
      content_id: metadata.contentId ?? null,
      product_id: metadata.productId ?? null,
      ...(typeof metadata.durationSeconds === "number"
        ? { duration_seconds: metadata.durationSeconds }
        : {}),
    },
  };
}
