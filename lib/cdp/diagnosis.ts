/**
 * 茶葉診断（Web 入口）の設問構造と採点（CDP 統合 Stage 4 / 欠陥 D8）。
 *
 * ## いま何が無かったか
 *
 * 好み診断は LINE にしか入口が無い。Web から来た人は、3 つ答えれば分かることを
 * 答える場所すら持っていなかった（トップページの Figma 節 8110:2514 は
 * 「`/diagnosis` が未実装のため出していない」と `app/[locale]/page.tsx` に
 * 明記されたまま止まっていた）。Stage 1 で L0 の受け口（`diagnosis.answer`）を
 * 先に作り、画面は後、と決めてあったので、ここが「後」にあたる。
 *
 * ## この画面が書くもの・書かないもの
 *
 * **書くのは L0（`customer_events`）だけ。** 答えた選択肢 3 つを事実として積む。
 * persona（解釈）はここでは書かない — persona の書き手は cx-agent
 * `preference-pipeline` 1 本という決まり（統合設計 T-1 / §6-3）で、Web が 2 人目の
 * 書き手になるとちょうど撤去したばかりの二重加算が形を変えて戻る。
 * 画面に出す「あなたは〇〇な人」は **その場の表示** であって、カルテではない。
 *
 * ## ⚠ 採点表は cx-agent の写しである（暫定・撤去予定）
 *
 * `SCORE_TABLE` / `DIAGNOSIS_CHOICE_COUNTS` の正本は cx-agent
 * `src/lib/preference-diagnosis.ts`（Spec: Notion 39c70c9d-064c-81bc-aa53-f95733ccee97 /
 * オーナー確定 2026-07-13）。同じ表が 2 リポジトリに在るので、**片方だけ変えると
 * Web の表示とカルテの primary がずれる**。
 *
 * 写しにした理由は 1 つだけ: 採点を返す口が cx-agent に無いから。恒久解は
 * cx-agent 側に `POST /api/cdp/diagnosis/result`（答え 3 つ → persona）を足し、
 * この表ごと消して口を呼ぶ形にすること。契約案は本 PR の報告に添えてある。
 *
 * それまでの間、写しであることを機械的に見えるようにしておく:
 *   - 値は `__tests__/cdp-diagnosis.test.ts` が 1 件ずつ固定する（黙って書き換わらない）。
 *   - この doc に SoT のパスを書く（`grep preference-diagnosis` で両側が出る）。
 * 「コメントに書いたから守られる」とは思っていない。だから撤去の道筋
 * （口を足す → ここを消す）を先に書いてある。
 */

import type { GatewayEvent } from "@/lib/cdp/events-gateway-client";

/** 診断の 3 ペルソナ。並びは同点時の先勝ち順でもある（cx-agent `PERSONA_AXES` と同一）。 */
export const PERSONA_AXES = ["serenity", "explorer", "sensory"] as const;

export type PersonaType = (typeof PERSONA_AXES)[number];

/** 各問の選択肢数。範囲外の答えを弾くのに使う（cx-agent `Q_CHOICES` の写し）。 */
export const DIAGNOSIS_CHOICE_COUNTS = { q1: 3, q2: 4, q3: 3 } as const;

export type DiagnosisQuestionId = keyof typeof DIAGNOSIS_CHOICE_COUNTS;

/** 設問の並び（画面の進行順。i18n のキーもこの id から組む）。 */
export const DIAGNOSIS_QUESTION_IDS: readonly DiagnosisQuestionId[] = ["q1", "q2", "q3"];

export interface DiagnosisAnswers {
  q1: number;
  q2: number;
  q3: number;
}

type PersonaScores = Record<PersonaType, number>;

/**
 * 加点表（cx-agent `SCORE_TABLE` の写し。Spec §5-1）。
 * S=serenity / E=explorer / G=sensory。
 */
const SCORE_TABLE: Record<DiagnosisQuestionId, Record<number, Partial<PersonaScores>>> = {
  q1: {
    1: { serenity: 3 }, // やすらぎ
    2: { explorer: 3 }, // 新しい出会い
    3: { sensory: 3 }, // 確かな味わい
  },
  q2: {
    1: { serenity: 2 }, // まろやかな甘み
    2: { explorer: 1, sensory: 1 }, // 香り高く個性
    3: { sensory: 2 }, // コク・余韻
    4: { serenity: 1, explorer: 1 }, // すっきり軽やか
  },
  q3: {
    1: { serenity: 2 }, // 寄り添う一杯
    2: { explorer: 2 }, // 試したい一杯
    3: { sensory: 2 }, // 合わせたい一杯
  },
};

/** 答えが選択肢の範囲に収まっているか（1 始まり）。 */
export function isValidChoice(question: DiagnosisQuestionId, choice: number): boolean {
  return (
    Number.isInteger(choice) && choice >= 1 && choice <= DIAGNOSIS_CHOICE_COUNTS[question]
  );
}

/**
 * 3 つの答えからその場の勝者を決める（純粋）。
 *
 * 同点は `PERSONA_AXES` の先勝ち。cx-agent `scoreDiagnosis` と同じ規則で、
 * ここを変えると LINE と Web で違うタイプが出る。
 */
export function scoreDiagnosis(answers: DiagnosisAnswers): PersonaType {
  const scores: PersonaScores = { serenity: 0, explorer: 0, sensory: 0 };
  for (const question of DIAGNOSIS_QUESTION_IDS) {
    const delta = SCORE_TABLE[question][answers[question]] ?? {};
    for (const [axis, value] of Object.entries(delta) as Array<[PersonaType, number]>) {
      scores[axis] += value;
    }
  }

  let winner: PersonaType = PERSONA_AXES[0];
  for (const axis of PERSONA_AXES) {
    if (scores[axis] > scores[winner]) winner = axis;
  }
  return winner;
}

/**
 * 答え 3 つを L0 の 3 イベントに写す（純粋）。
 *
 * **勝者は積まない。** 積むのは「何を選んだか」だけで、そこから何を読むかは L1 の
 * 仕事（統合設計 §3-2 の L0 = 事実 / L1 = 解釈）。勝者まで積むと、採点表を直した
 * ときに過去の行が古い解釈のまま残り、L0 から再計算できるという不変条件が壊れる。
 *
 * `occurredAt` は呼び出し側で **1 回だけ** 決めた値を渡す。3 件が同じ時刻を持つ
 * ことが「この 3 つは 1 回の診断」を表す唯一の手がかりでもある
 * （契約: cx-agent `docs/cdp-events-gateway-contract.md` §5）。
 */
export function toDiagnosisGatewayEvents(
  subject: { kind: string; value: string },
  answers: DiagnosisAnswers,
  occurredAt: string,
): GatewayEvent[] {
  return DIAGNOSIS_QUESTION_IDS.map((question) => ({
    event_type: "diagnosis.answer",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `${question}@${occurredAt}`,
    source: "web-app.diagnosis",
    occurred_at: occurredAt,
    /* 選んだ番号だけ。自由文も生の識別子も無い（契約 §6）。 */
    payload: { question_id: question, choice: answers[question] },
  }));
}
