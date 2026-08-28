"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getOrIssueAnonymousId } from "@/lib/cdp/anonymous-id";
import { usePessimisticMutation } from "@/lib/interaction/use-optimistic-mutation";
import {
  DIAGNOSIS_CHOICE_COUNTS,
  DIAGNOSIS_QUESTION_IDS,
  type DiagnosisAnswers,
  type DiagnosisQuestionId,
  type PersonaType,
} from "@/lib/cdp/diagnosis";

/**
 * 茶葉診断（Web 入口）の本体（CDP 統合 Stage 4 / 欠陥 D8）。
 *
 * 進行は welcome → q1 → q2 → q3 → 結果。q1 / q2 は選んだ瞬間に進み、q3 だけは
 * 選んでから「結果を見る」を押す形にしてある — 最後の 1 手だけはネットワークを
 * 待つので、**押した瞬間に進むもの（表示の切替）と、待つもの（送信）を
 * 混ぜない**（憲章 R9 の台帳でも別々の応答として宣言している）。
 *
 * 答えの送り先は `/api/diagnosis` 1 本。ここから Firestore へは何も書かない。
 */

/** 画面の段。数値の大小で戻る/進むを決めるので、順序に意味がある。 */
const STEP = { welcome: 0, q1: 1, q2: 2, q3: 3, result: 4 } as const;

const TOTAL_QUESTIONS = DIAGNOSIS_QUESTION_IDS.length;

type Answers = Partial<Record<DiagnosisQuestionId, number>>;

type StepVariants = {
  enter: { opacity: number; y?: number };
  center: { opacity: number; y?: number };
  exit: { opacity: number; y?: number };
};

const motionVariants: StepVariants = {
  enter: { opacity: 0, y: 24 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -24 },
};

const reducedMotionVariants: StepVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * persona → i18n キー。3 値すべてを持つ形にして、増えたら型で落とす。
 *
 * キーを `name` にしないのは意図的。cookie 台帳の走査
 * (`__tests__/auth-cookie-registry.test.ts`) は `name` という識別子を全ツリーの
 * `{ name: "リテラル" }` から解決するため、ここに `name: "..."` を置くと
 * **cookie 名がこの文字列だと誤って解決されて台帳検査が落ちる**（実際に落ちた）。
 */
const PERSONA_COPY_KEYS: Record<PersonaType, { nameKey: string; bodyKey: string }> = {
  serenity: { nameKey: "resultSerenityName", bodyKey: "resultSerenityBody" },
  explorer: { nameKey: "resultExplorerName", bodyKey: "resultExplorerBody" },
  sensory: { nameKey: "resultSensoryName", bodyKey: "resultSensoryBody" },
};

export function DiagnosisForm() {
  const t = useTranslations("diagnosis");
  const [step, setStep] = useState<number>(STEP.welcome);
  const [answers, setAnswers] = useState<Answers>({});
  const [persona, setPersona] = useState<PersonaType | null>(null);
  const [error, setError] = useState(false);

  /**
   * 送信は共通の通り道を通す（`lib/interaction`）。分類は `pessimistic-form` —
   * 出す結果をサーバが決めるので先に描けない代わりに、`isPending` が押した瞬間に
   * 立ち、二重送信はここで弾かれる（`mutation-classes.ts` の表）。
   */
  const submission = usePessimisticMutation<DiagnosisAnswers>({
    operation: "diagnosis.submit",
    mutationClass: "pessimistic-form",
    send: async (input) => {
      /* 同意 (consent="all") が無ければ null。その場合は送らない = 端末にも
         L0 にも痕跡を残さない（判定の正本は lib/cdp/anonymous-id.ts）。 */
      const anonymousId = getOrIssueAnonymousId();
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, ...(anonymousId ? { anonymousId } : {}) }),
      });
      if (!res.ok) throw new Error(`diagnosis responded ${res.status}`);
      const body = (await res.json()) as { persona?: PersonaType };
      if (!body.persona || !(body.persona in PERSONA_COPY_KEYS)) {
        throw new Error("diagnosis response has no known persona");
      }
      setPersona(body.persona);
      setStep(STEP.result);
      return body;
    },
    /* 失敗の記録は hook 側が `ui.mutation.commit-failed` で残す。ここは言い直しだけ。 */
    onFailure: () => setError(true),
  });

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const variants = prefersReducedMotion ? reducedMotionVariants : motionVariants;

  const choose = useCallback((question: DiagnosisQuestionId, choice: number) => {
    setAnswers((previous) => ({ ...previous, [question]: choice }));
    /* q3 は選んだだけでは進まない（送信は明示のボタン）。 */
    if (question !== "q3") setStep((current) => current + 1);
  }, []);

  const { run: runSubmission } = submission;
  const submit = useCallback(() => {
    const { q1, q2, q3 } = answers;
    if (q1 === undefined || q2 === undefined || q3 === undefined) return;
    setError(false);
    void runSubmission({ q1, q2, q3 });
  }, [answers, runSubmission]);

  const restart = useCallback(() => {
    setAnswers({});
    setPersona(null);
    setError(false);
    setStep(STEP.welcome);
  }, []);

  const back = useCallback(() => {
    setError(false);
    setStep((current) => (current > STEP.welcome ? current - 1 : current));
  }, []);

  const question = DIAGNOSIS_QUESTION_IDS[step - 1];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-background px-6 py-8 sm:px-8">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          data-slot="diagnosis-step"
          data-step={step}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {step === STEP.welcome && (
            <div className="space-y-6 py-8 text-center">
              <div className="space-y-2">
                <h2 className="text-2xl">{t("welcomeHeading")}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("welcomeDescription")}
                </p>
              </div>
              <Button onClick={() => setStep(STEP.q1)} className="w-full">
                {t("start")}
              </Button>
            </div>
          )}

          {question !== undefined && (
            <QuestionStep
              question={question}
              t={t}
              selected={answers[question]}
              onChoose={choose}
            />
          )}

          {step === STEP.result && persona !== null && (
            <div className="space-y-6 py-4 text-center">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("resultEyebrow")}
              </p>
              <div className="space-y-3">
                <h2 data-slot="diagnosis-persona" className="text-2xl">
                  {t(PERSONA_COPY_KEYS[persona].nameKey)}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(PERSONA_COPY_KEYS[persona].bodyKey)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t("resultNote")}</p>
              <div className="flex flex-col gap-3">
                <Button asChild className="w-full">
                  <Link href="/products">{t("resultCta")}</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={restart}>
                  {t("resultRestart")}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {question !== undefined && (
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={back} aria-label={t("back")}>
            {t("back")}
          </Button>

          <span data-slot="diagnosis-progress" className="text-sm text-muted-foreground">
            {t("stepOf", { current: step, total: TOTAL_QUESTIONS })}
          </span>

          {question === "q3" ? (
            <Button
              size="sm"
              onClick={submit}
              disabled={answers.q3 === undefined || submission.isPending}
              data-slot="diagnosis-submit"
              data-pending={submission.isPending ? "true" : undefined}
            >
              {submission.isPending ? t("submitting") : t("resultCta")}
            </Button>
          ) : (
            /* 進むのは選んだ瞬間なので「次へ」は置かない。左右の釣り合いだけ取る。 */
            <span aria-hidden="true" className="w-16" />
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {t("errorMessage")}
        </p>
      )}
    </div>
  );
}

function QuestionStep({
  question,
  t,
  selected,
  onChoose,
}: {
  question: DiagnosisQuestionId;
  t: ReturnType<typeof useTranslations>;
  selected: number | undefined;
  onChoose: (question: DiagnosisQuestionId, choice: number) => void;
}) {
  const choices = Array.from(
    { length: DIAGNOSIS_CHOICE_COUNTS[question] },
    (_, index) => index + 1,
  );

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t(`${question}Title`)}
        </p>
        <p className="text-base">{t(`${question}Question`)}</p>
      </div>
      <div className="flex flex-col gap-3">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            data-slot="diagnosis-choice"
            aria-pressed={selected === choice}
            onClick={() => onChoose(question, choice)}
            className={
              selected === choice
                ? "rounded-lg border border-primary bg-primary/5 px-4 py-3 text-left text-sm text-foreground"
                : "rounded-lg border border-border bg-background px-4 py-3 text-left text-sm text-muted-foreground hover:border-primary hover:text-foreground"
            }
          >
            {t(`${question}Choice${choice}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
