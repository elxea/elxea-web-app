import { z } from "zod";

import { AnonymousIdSchema } from "@/lib/validation/behavior-schema";
import { DIAGNOSIS_CHOICE_COUNTS } from "@/lib/cdp/diagnosis";

/**
 * `/api/diagnosis` が受け取る形（CDP 統合 Stage 4）。
 *
 * `behavior-schema.ts` と同じく **送り手と対になる契約**なので route の外に置く。
 * 選択肢の上限を `DIAGNOSIS_CHOICE_COUNTS` から作っているのは、設問を増やした
 * ときに白名簿の更新が漏れる（= 新しい選択肢が 400 で静かに捨てられる）のを
 * 構造的に防ぐため。読了イベントが何か月も欠け続けた監査 P1-3 と同じ失敗様式を
 * 二度やらない。
 *
 * `anonymousId` は任意。会員なら送られてこないし、同意が無ければ送り手が
 * そもそも発行しない（`lib/cdp/anonymous-id.ts`）。受けた側でも同意 cookie を
 * もう一度見る（fail-closed の二重ゲート・`resolveBehaviorSubject`）。
 */
const choice = (question: keyof typeof DIAGNOSIS_CHOICE_COUNTS) =>
  z.number().int().min(1).max(DIAGNOSIS_CHOICE_COUNTS[question]);

export const DiagnosisBodySchema = z
  .object({
    q1: choice("q1"),
    q2: choice("q2"),
    q3: choice("q3"),
    anonymousId: AnonymousIdSchema.optional(),
  })
  .strict();
