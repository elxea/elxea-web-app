import { z } from "zod";

import {
  CUP_ASPECTS,
  CUP_VERDICTS,
  PURCHASE_SCENES,
  SAFETY_TAGS,
} from "@/lib/cdp/cup-feedback";

/**
 * 顧客プロファイル 第1段の受け口が受け取る形（① / ⑤ / ⑥）。
 *
 * `behavior-schema.ts` / `diagnosis-schema.ts` と同じく、**送り手と対になる契約**
 * なので route の外に置く。白名簿は語彙 (`lib/cdp/cup-feedback.ts`) から作る
 * — 値を足したときに schema の更新が漏れると、新しい選択肢が 400 で静かに
 * 捨てられる（監査 P1-3 と同じ失敗様式）。
 *
 * ⚠ **自由文を受ける項目が 1 つも無い**のは意図的である。感想は「感想を送る」の
 * 別導線（お問い合わせ）で受け、L0 には 1 文字も載せない（契約 §6 / 設計 §7 #4）。
 */

/** 号の参照（Sanity の slug）。人を指す値は入らない。 */
const IssueRefSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/, "Invalid issue slug");

/** Tea Menu の 5 桁番号（cx-agent の `product_no` と同じ形）。 */
const ProductNoSchema = z.string().regex(/^\d{5}$/, "product number must be 5 digits");

/**
 * 届いた後の評価。**数値は受けない** — 送られてくるのは記述語のキーだけで、
 * 1-5 へ畳むのはサーバ側の `verdictScore()` 1 か所（設計 §7 #4 の確定条件
 * 「お客さんには星・数値を見せない」を、送り手が数値を持たない形で守る）。
 *
 * `decline`（いまは答えない）と `verdict` は排他。両方来たときは弾く。
 */
export const CupFeedbackBodySchema = z
  .union([
    z
      .object({
        productNo: ProductNoSchema,
        issueRef: IssueRefSchema,
        verdict: z.enum(CUP_VERDICTS),
        aspect: z.enum(CUP_ASPECTS).optional(),
      })
      .strict(),
    z
      .object({
        productNo: ProductNoSchema,
        issueRef: IssueRefSchema,
        decline: z.literal(true),
      })
      .strict(),
  ]);

/** 「誰のために買ったか」（⑤）。注文の参照は Shopify の注文 ID。 */
export const PurchaseRecipientBodySchema = z
  .object({
    orderId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "Invalid order id"),
    scene: z.enum(PURCHASE_SCENES),
  })
  .strict();

/**
 * 避けたいものの申告（⑥）。
 *
 * `consent` は必須の `true`。**要配慮相当を含む申告なので、明示同意の無い送信は
 * 受け口の形として成立しない**（設計 §2 の判定列「妊娠は病歴に当たらないが、
 * 要配慮相当として扱う（明示同意・厳格管理）」）。画面のチェックが外れていれば
 * そもそも送れないが、受け口側でも同じ条件を持つ（fail-closed の二重ゲート）。
 */
export const SafetyDeclarationBodySchema = z
  .object({
    tags: z.array(z.enum(SAFETY_TAGS)).min(1).max(SAFETY_TAGS.length),
    consent: z.literal(true),
  })
  .strict();
