/**
 * アンケート（AI ティーコンシェルジュ体験の CSAT / NPS）1 回分を L0 の形に写す
 * （純粋・CDP 統合 Stage 4）。
 *
 * ## なぜ Stage 4 でここを触るのか
 *
 * Stage 1 で行動ログは events gateway を通るようになったが、**アンケートだけは
 * 通っていなかった**。`/api/survey` は cx-agent の口へ素通しするだけで、L0 には
 * 1 行も残らない。結果、「診断で何を選んだか」（本 Stage で L0 に入る）と
 * 「体験をどう評価したか」が別々の場所にあり、同じ人の話として繋がらない。
 * Stage 4 の完了条件「survey 経路の事実が events gateway 経由で L0 に積まれる」は
 * ここのことである。
 *
 * ## 自由文は積まない（契約 §6）
 *
 * 設問 5 問のうち `improvement_suggestion`（改善要望・自由記述）だけは L0 に
 * 載せない。L0 の payload は PII を持たない約束で、自由文はその約束を守れない
 * （名前も連絡先も書かれうる）。**入れないよう気をつける**のではなく、写す関数が
 * 受け取らない形にしてある — この関数のシグネチャに自由文は無い。
 * 自由文の置き場は従来どおり cx-agent 側のアンケート表であって L0 ではない。
 *
 * 契約（payload の形・冪等キー・語彙）の正本は cx-agent
 * `docs/cdp-events-gateway-contract.md`。ここは写す側であって、契約は持たない。
 */

import type { GatewayEvent } from "@/lib/cdp/events-gateway-client";

/** L0 に積む設問（自由文の 1 問は意図的に含まない）。 */
export interface SurveyFacts {
  csat: number;
  would_use_again: string;
  best_aspects: string[];
  nps: number;
  round: number;
}

/**
 * アンケート 1 回分を 4 イベントに写す（設問ごとに 1 件）。
 *
 * 設問ごとに分けるのは、`dedupe` が「同じ現実の出来事なら同じ文字列」を要件と
 * するから（契約 §5 の「アンケートの回答 = `<questionId>@<occurredAt>`」）。
 * 1 件にまとめると、後から 1 問だけ答え直したときに別の出来事として数えられない。
 *
 * `occurredAt` は呼び出し側で 1 回だけ決めた値を渡すこと（2 回計算すると別の鍵に
 * なり、再送で 2 行になる）。
 */
export function toSurveyGatewayEvents(
  subject: { kind: string; value: string },
  facts: SurveyFacts,
  occurredAt: string,
): GatewayEvent[] {
  const answers: Array<{ questionId: string; value: number | string | string[] }> = [
    { questionId: "csat", value: facts.csat },
    { questionId: "would_use_again", value: facts.would_use_again },
    { questionId: "best_aspects", value: facts.best_aspects },
    { questionId: "nps", value: facts.nps },
  ];

  return answers.map(({ questionId, value }) => ({
    event_type: "survey.answer_recorded",
    channel: "web",
    identifier_kind: subject.kind,
    identifier_value: subject.value,
    dedupe: `${questionId}@${occurredAt}`,
    source: "web-app.survey",
    occurred_at: occurredAt,
    /* 数値と列挙値だけ。自由文はこの関数に渡ってこない。 */
    payload: { question_id: questionId, value, round: facts.round },
  }));
}
