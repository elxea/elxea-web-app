/**
 * 届いた後の評価・誰のために・避けたいもの — 画面側の語彙と L0 への写し
 * （顧客プロファイル 第1段 ① / ⑤ / ⑥ / ⑦・純粋）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 / §7 択一 #4・#11 /
 * §4 R2（数値・星・点数・バッジを出さない）/ §2「絶対に越えない線」。
 *
 * ## この module が持つもの
 *
 *   (a) 5 段階の**記述語**の語彙（①）— 画面に出る言葉と、内部の 1-5 の対応表。
 *   (b) 「どこが」4 択（①の任意 1 問）。
 *   (c) 「誰のために」2 択（⑤）。
 *   (d) 避けたいものの**閉じた**語彙（⑥）。
 *   (e) 上記を events gateway の 1 件に写す関数（③ 出所は `source` に出る）。
 *
 * ## ⚠ 数値は画面にも通信にも出さない（択一 #4 の確定条件）
 *
 * 択一 #4 は「(c) 5 段階。ただし**スコアは内部利用のみで、お客さんには星・数値を
 * 見せない**」で確定した（2026-09-01）。だから
 *
 *   - 画面に出るのは `CUP_VERDICT_LABEL_KEYS` が指す**記述語だけ**（星も数字も無い）。
 *   - ブラウザから送られてくるのも **語** (`CupVerdict`) であって数値ではない。
 *     数値へ畳むのはサーバ側の `verdictScore()` 1 か所。
 *
 * 数値を送り手に持たせない形にしてあるのは、「見せない」を注意力ではなく
 * **持っていない**で守るため。UI から数値へ触る道が無い。
 *
 * ## ⚠ 語彙の正本は cx-agent 側にある（写しであることの明示）
 *
 * `rating.submitted` / `purchase.recipient_declared` / `safety.declared` の型名と
 * payload の形、`RATING_ASPECTS`・`PURCHASE_SCENES` の値は
 * **elxea-cx-agent `src/lib/cdp/event-vocabulary.ts` が正本**（migration 051 と対）。
 * 契約は `elxea-cx-agent/docs/cdp-events-gateway-contract.md`。
 *
 * ここは `lib/cdp/diagnosis.ts` と同じ「写し」であり、同じ危険を持つ
 * （片方だけ変えると出来事が `schema_ok = false` で L1 に入らなくなる）。
 * 同じ作法で扱う:
 *   - 値は `__tests__/cup-feedback.test.ts` が 1 件ずつ固定する（黙って書き換わらない）。
 *   - この doc に正本のパスを書く（`grep event-vocabulary` で両側が出る）。
 * 恒久解は cx-agent 側が語彙を配る口を持つこと。それまでは写しである。
 *
 * ## 自由文はここを通らない
 *
 * 「感想を送る」は別導線（お問い合わせ）で、L0 には 1 文字も載せない。この
 * module の関数は自由文を**引数に取らない**ので、載せる場所が無い（契約 §6）。
 */

import type { GatewayEvent } from "@/lib/cdp/events-gateway-client";

// ---------------------------------------------------------------------------
// (a) 5 段階の記述語（①）
// ---------------------------------------------------------------------------

/**
 * 届いた一杯への答え。**並びは「合った」側から「合わなかった」側へ**。
 *
 * 語は「合う / 合わない」の系列にしてある。設計の元の 2 択が
 * 「合った / 合わなかった」で、5 段階はその解像度を上げたものだから
 * （§2「聞く」の表 / §7 #4 の確定注記）。「良い・悪い」の語は使わない。
 */
export const CUP_VERDICTS = ["great", "good", "neutral", "slightMiss", "miss"] as const;

export type CupVerdict = (typeof CUP_VERDICTS)[number];

/**
 * 語 → 内部の 1-5。**この対応表は web-app が正本**（cx-agent は 1-5 しか知らない）。
 *
 * 5 が「いちばん合った」。`isRatingPayload`（cx-agent）が受けるのは 1-5 の整数で、
 * そこから先の重み付けは第3段 ⑯ の仕事なので、ここでは等間隔に置くだけにする。
 */
export const CUP_VERDICT_SCORES: Record<CupVerdict, number> = {
  great: 5,
  good: 4,
  neutral: 3,
  slightMiss: 2,
  miss: 1,
};

/** i18n のキー（`thisMonth` 名前空間）。画面に出る言葉はここからしか来ない。 */
export const CUP_VERDICT_LABEL_KEYS: Record<CupVerdict, string> = {
  great: "verdictGreat",
  good: "verdictGood",
  neutral: "verdictNeutral",
  slightMiss: "verdictSlightMiss",
  miss: "verdictMiss",
};

export function isCupVerdict(value: unknown): value is CupVerdict {
  return typeof value === "string" && (CUP_VERDICTS as readonly string[]).includes(value);
}

/** 語を内部の 1-5 に畳む。**サーバ側でだけ呼ぶ**（画面は数値を知らない）。 */
export function verdictScore(verdict: CupVerdict): number {
  return CUP_VERDICT_SCORES[verdict];
}

// ---------------------------------------------------------------------------
// (b) 「どこが」4 択（①の任意 1 問）
// ---------------------------------------------------------------------------

/**
 * 合わなかったときに任意で聞く 1 問（設計 §2「どこが (香り / 濃さ / 後味 / 量)」）。
 * 値は cx-agent `RATING_ASPECTS` の写し。
 */
export const CUP_ASPECTS = ["aroma", "strength", "aftertaste", "amount"] as const;

export type CupAspect = (typeof CUP_ASPECTS)[number];

export function isCupAspect(value: unknown): value is CupAspect {
  return typeof value === "string" && (CUP_ASPECTS as readonly string[]).includes(value);
}

/**
 * その答えのときに「どこが」を聞くか。
 *
 * 合わなかった側だけ聞く。合った側に聞くと、設計 §2 原則の「入力作業に
 * 感じさせない」から遠ざかるだけで、次に活かせる情報が増えない。
 */
export function asksAspect(verdict: CupVerdict): boolean {
  return verdict === "slightMiss" || verdict === "miss";
}

// ---------------------------------------------------------------------------
// (c) 「誰のために」2 択（⑤）
// ---------------------------------------------------------------------------

/**
 * 誰のために買ったか。cx-agent `PURCHASE_SCENES` の写し。
 *
 * ⚠ **2 値に閉じている**。自分用と贈答は構造が違う（設計 §3「自分用と贈答は
 * 別モデル」）ので、3 つ目を足す種類の語彙ではない。
 */
export const PURCHASE_SCENES = ["self", "gift"] as const;

export type PurchaseScene = (typeof PURCHASE_SCENES)[number];

export function isPurchaseScene(value: unknown): value is PurchaseScene {
  return typeof value === "string" && (PURCHASE_SCENES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// (d) 避けたいもの（⑥）— 閉じた語彙
// ---------------------------------------------------------------------------

/**
 * 安全に関する申告の語彙。**閉じている**（自由文は受けない）。
 *
 * ─ なぜ閉じるのか ─
 *   L0 の payload は PII を持たない約束で、自由文はその約束を守れない（契約 §6）。
 *   加えて設計 §2「絶対に越えない線」は病名・服薬の取得を禁じている。閉じた語彙
 *   なら、書ける内容が構造的に「お茶を外すための区分」に限られる。
 *
 * ─ `pregnancy` を持つ理由と扱い ─
 *   妊娠は病歴ではないが**要配慮相当**として扱う（設計 §2 の判定列）。よって
 *   本人が自分で申告したときだけ立ち、**推定では絶対に立てない**（§2「推す」の
 *   最終行 / R4）。画面側で明示同意を取ってから送る。
 */
export const SAFETY_TAGS = ["caffeine", "pregnancy", "allergy"] as const;

export type SafetyTag = (typeof SAFETY_TAGS)[number];

export function isSafetyTag(value: unknown): value is SafetyTag {
  return typeof value === "string" && (SAFETY_TAGS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// (e) L0 への写し
// ---------------------------------------------------------------------------

/** 主体の指し方（`resolveBehaviorSubject` が返す解決済みの形だけを受ける）。 */
export interface CupSubject {
  kind: string;
  value: string;
}

/** Tea Menu の 5 桁番号（cx-agent `PRODUCT_NO_FORM` と同じ形）。 */
const PRODUCT_NO_FORM = /^\d{5}$/;

export function isProductNo(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_NO_FORM.test(value);
}

/**
 * 届いた後の評価 1 件を L0 の 1 イベントに写す（純粋）。
 *
 * `dedupe` が `<productNo>@<occurredAt>` なのは契約 §5 の「商品評価」の行に従う。
 * 同じお茶を後から付け直したら別の出来事になる（訂正は上書きではなく追記・
 * 設計 §4「訂正は事実として記録に積む」）。
 *
 * `occurredAt` は呼び出し側で **1 回だけ** 決めた値を渡すこと。
 */
export function toRatingGatewayEvent(
  subject: CupSubject,
  input: { productNo: string; verdict: CupVerdict; aspect?: CupAspect; deliveryRef?: string },
  occurredAt: string,
): GatewayEvent {
  return {
    event_type: "rating.submitted",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `${input.productNo}@${occurredAt}`,
    source: "web-app.cup-feedback",
    occurred_at: occurredAt,
    /* 数値の `score` はここで初めて現れる（画面も通信も語しか持たない）。 */
    payload: {
      product_no: input.productNo,
      score: verdictScore(input.verdict),
      ...(input.aspect ? { aspect: input.aspect } : {}),
      ...(input.deliveryRef ? { delivery_ref: input.deliveryRef } : {}),
    },
  };
}

/**
 * 「誰のために買ったか」1 件を L0 の 1 イベントに写す（純粋）。
 *
 * `dedupe` は注文 1 本（契約 §5 の「注文」の行）。**1 注文につき 1 回**に閉じ、
 * 押し間違いの訂正は第2段の訂正経路で受ける（設計 §6 第2段 ⑧⑪）。2 回目は
 * gateway が `duplicate_idempotency_key` で静かに落とすので、二重に数えられない。
 */
export function toRecipientGatewayEvent(
  subject: CupSubject,
  input: { orderRef: string; scene: PurchaseScene },
  occurredAt: string,
): GatewayEvent {
  return {
    event_type: "purchase.recipient_declared",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `order:${input.orderRef}`,
    source: "web-app.cup-feedback",
    occurred_at: occurredAt,
    payload: { scene: input.scene, order_ref: input.orderRef },
  };
}

/**
 * 避けたいものの申告を L0 の 1 イベントに写す（純粋）。
 *
 * ⚠ **足す方向にしか使えない**。cx-agent の L1 は `safety.declared` を
 * 「減らす方向に畳まない」（`event-vocabulary.ts` の一覧）ので、解除を表す
 * 出来事がまだ無い。画面もそれに合わせて**追加だけ**にしてある
 * （解除は第2段で `safety.cleared` を足してから）。
 */
export function toSafetyGatewayEvent(
  subject: CupSubject,
  tags: readonly SafetyTag[],
  occurredAt: string,
): GatewayEvent {
  return {
    event_type: "safety.declared",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `safety:${[...tags].sort().join("+")}@${occurredAt}`,
    source: "web-app.safety",
    occurred_at: occurredAt,
    payload: { tags: [...tags].sort() },
  };
}

/**
 * 「聞く画面を出した」を L0 に残す（⑦ 回答率の計測）。
 *
 * ─ なぜ要るのか ─
 *   降伏条件（設計 §2）は回答率で判定する。分母のうち「配送数」は
 *   `shipment.sent` から出るが、**「聞ける状態になったのに答えなかった」**は
 *   出した回数を残さないと出ない。フロー語彙 `feedback.shown` が既に登録簿に
 *   あるのでそれを使う（新しい語彙を足さない）。
 *
 * ⚠ これは**評価ではない**ので L1 は畳まない（`PROFILE_EVENT_TYPES` に無い）。
 *   無回答を否定信号にしない、という設計 §2「無回答の扱い」と整合する。
 */
export function toFeedbackShownGatewayEvent(
  subject: CupSubject,
  input: { issueRef: string; productNos: readonly string[]; day: string },
  occurredAt: string,
): GatewayEvent {
  return {
    event_type: "flow.feedback_shown",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    /* 1 人 × 1 号 × 1 日で 1 行に畳む。開くたびに積むと、分母が「開いた回数」に
       なってしまい、回答率が見た目より小さく出る（何度も開く人ほど下がる）。 */
    dedupe: `shown:${input.issueRef}@${input.day}`,
    source: "web-app.cup-feedback",
    occurred_at: occurredAt,
    payload: {
      issue_ref: input.issueRef,
      product_nos: [...input.productNos].sort(),
      count: input.productNos.length,
    },
  };
}

/**
 * その時刻の JST 暦日（`YYYY-MM-DD`）。
 *
 * `Intl` に日付を組ませる（手で 9 時間足すと、うるう・夏時間の無い JST でも
 * 月跨ぎの繰り上がりを自前で書くことになり、そこが必ず間違う）。
 */
export function jstDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * 「いまは答えない」を押されたことを残す（⑦）。
 *
 * ⚠ **否定信号にしない**（設計 §2「無回答の扱い」）。だから
 *   `rating.submitted` ではなくフロー語彙 `survey.decline` で積む — L1 は
 *   フローを畳まないので、見立ては 1 ミリも動かない。動くのは運営側の
 *   回答率の分子・分母だけである。
 */
export function toFeedbackDeclinedGatewayEvent(
  subject: CupSubject,
  productNo: string,
  occurredAt: string,
): GatewayEvent {
  return {
    event_type: "flow.survey_decline",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `${productNo}@${occurredAt}`,
    source: "web-app.cup-feedback",
    occurred_at: occurredAt,
    payload: { product_no: productNo },
  };
}
