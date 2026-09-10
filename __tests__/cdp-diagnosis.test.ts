/**
 * 茶葉診断 Web 入口（CDP 統合 Stage 4 / 欠陥 D8）が守る契約。
 *
 * ## なぜこのテストが要るか
 *
 * この画面は「答えた事実を残す」ためのもので、壊れ方はどれも静かである。
 *
 *   1. **同意していない匿名の人を積んでしまう** — 画面は何も変わらないまま、裏で
 *      L0 に行が増える。Stage 1 の二重ゲート（送り手 + サーバ）をこの新しい口でも
 *      通していることを確かめる。
 *   2. **自由文や生の識別子が payload に混ざる** — 契約 §6 で L0 の payload は PII を
 *      持たないと決めてある。混ざっても 200 が返るので、送った側は気づけない。
 *   3. **採点表が cx-agent とずれる** — `lib/cdp/diagnosis.ts` の表は cx-agent
 *      `src/lib/preference-diagnosis.ts` の写しであり、片方だけ直すと Web の表示と
 *      カルテの primary が別のことを言い出す。値を 1 件ずつ固定して、黙って
 *      書き換わらないようにする。
 *   4. **Web が persona の 2 人目の書き手になる** — Stage 0 で撤去したばかりの
 *      二重加算（T-1）の再発。ソースレベルで「この経路は Firestore を書かない」を
 *      assert する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DIAGNOSIS_CHOICE_COUNTS,
  DIAGNOSIS_QUESTION_IDS,
  PERSONA_AXES,
  isValidChoice,
  scoreDiagnosis,
  toDiagnosisGatewayEvents,
} from "@/lib/cdp/diagnosis";
import { toSurveyGatewayEvents } from "@/lib/cdp/survey-fact";
import { DiagnosisBodySchema } from "@/lib/validation/diagnosis-schema";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const SUBJECT = { kind: "web_anonymous_id", value: "a".repeat(32) };
const OCCURRED_AT = "2026-08-29T01:02:03.000Z";

// ---------------------------------------------------------------------------
// 1. 採点表 — cx-agent の写しであることを 1 件ずつ固定する
// ---------------------------------------------------------------------------

describe("採点は cx-agent preference-diagnosis.ts と同じ答えを返す", () => {
  it("設問の選択肢数が cx-agent の Q_CHOICES と同じ", () => {
    expect(DIAGNOSIS_CHOICE_COUNTS).toEqual({ q1: 3, q2: 4, q3: 3 });
    expect(DIAGNOSIS_QUESTION_IDS).toEqual(["q1", "q2", "q3"]);
  });

  it("同点の先勝ち順が serenity → explorer → sensory", () => {
    expect(PERSONA_AXES).toEqual(["serenity", "explorer", "sensory"]);
  });

  /**
   * Q1 は +3 のアンカーなので、Q2・Q3 を最も薄い組み合わせにすると Q1 が勝つ。
   * 「Q1 の 3 択がそれぞれどの軸を指すか」がここで固定される。
   */
  it.each([
    [1, "serenity"],
    [2, "explorer"],
    [3, "sensory"],
  ] as const)("Q1=%i のアンカーは %s", (q1, expected) => {
    expect(scoreDiagnosis({ q1, q2: 2, q3: q1 === 1 ? 2 : 1 })).toBe(expected);
  });

  /**
   * 表そのものを外から見る術が無いので、**表の 1 セルを動かすと落ちる組み合わせ**を
   * 並べる。期待値は cx-agent の SCORE_TABLE を手で回した結果と一致する。
   */
  it.each([
    /* q1, q2, q3, 期待 — 内訳 */
    [1, 1, 1, "serenity"], // S3+S2+S2 = 7
    [2, 2, 2, "explorer"], // E3 + E1G1 + E2 = E6 / G1
    [3, 3, 3, "sensory"], // G3+G2+G2 = 7
    [2, 1, 1, "serenity"], // E3 / S2+S2=S4 → アンカーより積み上げが勝つ
    [3, 4, 1, "serenity"], // G3 / S1+S2=S3 / E1 → S3 と G3 の同点 → 先勝ちで serenity
    [1, 3, 2, "serenity"], // S3 / G2 / E2 → 同点 3 軸ではなく S3 が単独最大
    [2, 4, 3, "explorer"], // E3+S1E1+G2 → E4 / S1 / G2
    [3, 2, 1, "sensory"], // G3+E1G1+S2 → G4 / E1 / S2
  ] as const)("q1=%i q2=%i q3=%i → %s", (q1, q2, q3, expected) => {
    expect(scoreDiagnosis({ q1, q2, q3 })).toBe(expected);
  });

  it("すべての組み合わせが 3 ペルソナのいずれかに落ちる（欠けたセルで undefined にならない）", () => {
    for (let q1 = 1; q1 <= DIAGNOSIS_CHOICE_COUNTS.q1; q1 += 1) {
      for (let q2 = 1; q2 <= DIAGNOSIS_CHOICE_COUNTS.q2; q2 += 1) {
        for (let q3 = 1; q3 <= DIAGNOSIS_CHOICE_COUNTS.q3; q3 += 1) {
          expect(PERSONA_AXES).toContain(scoreDiagnosis({ q1, q2, q3 }));
        }
      }
    }
  });

  it("範囲外の選択肢は弾く", () => {
    expect(isValidChoice("q2", 4)).toBe(true);
    expect(isValidChoice("q1", 4)).toBe(false);
    expect(isValidChoice("q3", 0)).toBe(false);
    expect(isValidChoice("q1", 1.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. 受け口の白名簿 — 送り手とずれたら落ちる
// ---------------------------------------------------------------------------

describe("/api/diagnosis の受け口", () => {
  it("正しい答えを通す", () => {
    expect(DiagnosisBodySchema.safeParse({ q1: 1, q2: 4, q3: 3 }).success).toBe(true);
  });

  it("選択肢数は採点表から作られる（q2 だけ 4 まで通る）", () => {
    expect(DiagnosisBodySchema.safeParse({ q1: 1, q2: 4, q3: 1 }).success).toBe(true);
    expect(DiagnosisBodySchema.safeParse({ q1: 4, q2: 1, q3: 1 }).success).toBe(false);
    expect(DiagnosisBodySchema.safeParse({ q1: 1, q2: 5, q3: 1 }).success).toBe(false);
  });

  it("匿名 ID は 32 桁 16 進数だけ（任意文字列で L0 に幽霊の主体を生やせない）", () => {
    expect(
      DiagnosisBodySchema.safeParse({ q1: 1, q2: 1, q3: 1, anonymousId: "a".repeat(32) })
        .success,
    ).toBe(true);
    expect(
      DiagnosisBodySchema.safeParse({ q1: 1, q2: 1, q3: 1, anonymousId: "not-an-id" })
        .success,
    ).toBe(false);
  });

  it("知らない項目は弾く（strict）", () => {
    expect(
      DiagnosisBodySchema.safeParse({ q1: 1, q2: 1, q3: 1, persona: "serenity" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. L0 に積む形 — 事実だけを、PII なしで
// ---------------------------------------------------------------------------

describe("診断の答えを L0 の形に写す", () => {
  const events = toDiagnosisGatewayEvents(SUBJECT, { q1: 2, q2: 3, q3: 1 }, OCCURRED_AT);

  it("設問ごとに 1 件（3 件）", () => {
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload?.question_id)).toEqual(["q1", "q2", "q3"]);
    expect(events.map((e) => e.payload?.choice)).toEqual([2, 3, 1]);
  });

  it("契約の語彙どおり（event_type / channel / source）", () => {
    for (const event of events) {
      expect(event.event_type).toBe("diagnosis.answer");
      expect(event.channel).toBe("web");
      expect(event.source).toBe("web-app.diagnosis");
      expect(event.occurred_at).toBe(OCCURRED_AT);
      expect(event.identifier_kind).toBe(SUBJECT.kind);
    }
  });

  it("冪等キーの素は設問ごとに違い、同じ答えなら何度組んでも同じ", () => {
    expect(events.map((e) => e.dedupe)).toEqual([
      `q1@${OCCURRED_AT}`,
      `q2@${OCCURRED_AT}`,
      `q3@${OCCURRED_AT}`,
    ]);
    expect(new Set(events.map((e) => e.dedupe)).size).toBe(3);
    expect(toDiagnosisGatewayEvents(SUBJECT, { q1: 2, q2: 3, q3: 1 }, OCCURRED_AT)).toEqual(
      events,
    );
  });

  it("解釈（persona）は積まない — L0 は事実だけ", () => {
    const serialized = JSON.stringify(events.map((e) => e.payload));
    for (const axis of PERSONA_AXES) {
      expect(serialized).not.toContain(axis);
    }
  });

  it("payload に生の識別子が落ちない", () => {
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toContain(SUBJECT.value);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. アンケートの事実 — 自由文は L0 に入れない
// ---------------------------------------------------------------------------

describe("アンケートの答えを L0 の形に写す", () => {
  const facts = {
    csat: 5,
    would_use_again: "yes",
    best_aspects: ["tea_knowledge", "pleasant_conversation"],
    nps: 9,
    round: 1,
  };
  const events = toSurveyGatewayEvents(SUBJECT, facts, OCCURRED_AT);

  it("自由文以外の 4 問が 1 件ずつ", () => {
    expect(events.map((e) => e.payload?.question_id)).toEqual([
      "csat",
      "would_use_again",
      "best_aspects",
      "nps",
    ]);
    expect(events).toHaveLength(4);
  });

  it("契約の語彙どおり（event_type / source / dedupe）", () => {
    for (const event of events) {
      expect(event.event_type).toBe("survey.answer_recorded");
      expect(event.channel).toBe("web");
      expect(event.source).toBe("web-app.survey");
    }
    expect(events.map((e) => e.dedupe)).toEqual([
      `csat@${OCCURRED_AT}`,
      `would_use_again@${OCCURRED_AT}`,
      `best_aspects@${OCCURRED_AT}`,
      `nps@${OCCURRED_AT}`,
    ]);
  });

  it("自由文を渡す口が無い（型にも実行時にも改善要望が現れない）", () => {
    /* 呼び出し側が誤って足しても、写す関数は知らない項目を読まない。 */
    const withFreeText = toSurveyGatewayEvents(
      SUBJECT,
      { ...facts, improvement_suggestion: "090-0000-0000 まで連絡ください" } as Parameters<
        typeof toSurveyGatewayEvents
      >[1],
      OCCURRED_AT,
    );
    expect(JSON.stringify(withFreeText)).not.toContain("090-0000-0000");
    expect(JSON.stringify(withFreeText)).not.toContain("improvement_suggestion");
  });
});

// ---------------------------------------------------------------------------
// 5. 配線 assert — この経路は persona の 2 人目の書き手にならない
// ---------------------------------------------------------------------------

describe("Stage 4 の web 経路はカルテを書かない（T-1 の再発防止）", () => {
  const sources = [
    "app/api/diagnosis/route.ts",
    "lib/cdp/diagnosis.ts",
    "lib/cdp/survey-fact.ts",
    "app/[locale]/diagnosis/diagnosis-form.tsx",
  ];

  it.each(sources)("%s は Firestore の書き込みを import しない", (rel) => {
    const source = read(rel);
    /* 書き込み系の入口（server-actions / firestore admin / persona 更新）。 */
    expect(source).not.toMatch(/from "@\/lib\/firebase\/server-actions"/);
    expect(source).not.toMatch(/firebase-admin/);
    expect(source).not.toMatch(/computePersonaUpdate|mergePersonaScores/);
  });

  it("答えの送り先は events gateway 1 本（route が直に Supabase / Firestore を触らない）", () => {
    const route = read("app/api/diagnosis/route.ts");
    expect(route).toContain('from "@/lib/cdp/events-gateway-client"');
    expect(route).not.toMatch(/createClient|supabase/i);
  });

  it("アンケート経路も L0 へは gateway 経由で入る", () => {
    const route = read("app/api/survey/route.ts");
    expect(route).toContain('from "@/lib/cdp/events-gateway-client"');
    expect(route).toContain('from "@/lib/cdp/survey-fact"');
  });

  it("採点表の写し元が doc に明記されている（撤去の道筋を失わない）", () => {
    const source = read("lib/cdp/diagnosis.ts");
    expect(source).toContain("preference-diagnosis.ts");
    expect(source).toContain("/api/cdp/diagnosis/result");
  });
});
