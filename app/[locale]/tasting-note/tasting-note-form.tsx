"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { Leaf } from "lucide-react";

const TOTAL_STEPS = 5;

const BEST_ASPECT_KEYS = [
  "q3Accuracy",
  "q3Knowledge",
  "q3Conversation",
  "q3Discovery",
  "q3Other",
] as const;

const BEST_ASPECT_VALUES: Record<(typeof BEST_ASPECT_KEYS)[number], string> = {
  q3Accuracy: "recommendation_accuracy",
  q3Knowledge: "tea_knowledge",
  q3Conversation: "pleasant_conversation",
  q3Discovery: "easy_discovery",
  q3Other: "other",
};

type SurveyData = {
  csat: number | null;
  would_use_again: string | null;
  best_aspects: string[];
  improvement_suggestion: string;
  nps: number | null;
};

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

export function TastingNoteForm() {
  const t = useTranslations("tastingNote");
  const [step, setStep] = useState(0); // 0 = welcome, 1-5 = questions, 6 = complete
  const [data, setData] = useState<SurveyData>({
    csat: null,
    would_use_again: null,
    best_aspects: [],
    improvement_suggestion: "",
    nps: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const variants = prefersReducedMotion ? reducedMotionVariants : motionVariants;

  const canProceed = useCallback(() => {
    switch (step) {
      case 0:
        return true;
      case 1:
        return data.csat !== null;
      case 2:
        return data.would_use_again !== null;
      case 3:
        return data.best_aspects.length > 0;
      case 4:
        return true; // Q4 is optional
      case 5:
        return data.nps !== null;
      default:
        return false;
    }
  }, [step, data]);

  const handleNext = useCallback(async () => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
    } else if (step === TOTAL_STEPS) {
      // Submit
      setSubmitting(true);
      setError(false);
      try {
        const res = await fetch("/api/survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csat: data.csat,
            would_use_again: data.would_use_again,
            best_aspects: data.best_aspects,
            improvement_suggestion: data.improvement_suggestion || null,
            nps: data.nps,
            round: 1,
          }),
        });
        if (!res.ok) throw new Error("Submit failed");
        setStep(TOTAL_STEPS + 1);
      } catch {
        setError(true);
      } finally {
        setSubmitting(false);
      }
    }
  }, [step, data]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  return (
    <div className="relative overflow-hidden">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <StepWrapper key="welcome" variants={variants}>
            <WelcomeStep
              t={t}
              onStart={() => setStep(1)}
            />
          </StepWrapper>
        )}

        {step === 1 && (
          <StepWrapper key="q1" variants={variants}>
            <CsatStep
              t={t}
              value={data.csat}
              onChange={(v) => setData((d) => ({ ...d, csat: v }))}
              onNext={() => setStep(2)}
            />
          </StepWrapper>
        )}

        {step === 2 && (
          <StepWrapper key="q2" variants={variants}>
            <WouldUseAgainStep
              t={t}
              value={data.would_use_again}
              onChange={(v) => {
                setData((d) => ({ ...d, would_use_again: v }));
                // Auto-advance after selection
                setTimeout(() => setStep(3), 300);
              }}
            />
          </StepWrapper>
        )}

        {step === 3 && (
          <StepWrapper key="q3" variants={variants}>
            <BestAspectsStep
              t={t}
              value={data.best_aspects}
              onChange={(v) => setData((d) => ({ ...d, best_aspects: v }))}
            />
          </StepWrapper>
        )}

        {step === 4 && (
          <StepWrapper key="q4" variants={variants}>
            <ImprovementStep
              t={t}
              value={data.improvement_suggestion}
              onChange={(v) =>
                setData((d) => ({ ...d, improvement_suggestion: v }))
              }
            />
          </StepWrapper>
        )}

        {step === 5 && (
          <StepWrapper key="q5" variants={variants}>
            <NpsStep
              t={t}
              value={data.nps}
              onChange={(v) => setData((d) => ({ ...d, nps: v }))}
            />
          </StepWrapper>
        )}

        {step === TOTAL_STEPS + 1 && (
          <StepWrapper key="complete" variants={variants}>
            <CompleteStep t={t} />
          </StepWrapper>
        )}
      </AnimatePresence>

      {/* Navigation bar */}
      {step >= 1 && step <= TOTAL_STEPS && (
        <div className="mt-8 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            aria-label={t("back")}
          >
            {t("back")}
          </Button>

          <span className="text-sm text-muted-foreground">
            {t("stepOf", { current: step, total: TOTAL_STEPS })}
          </span>

          <div className="flex gap-2">
            {step === 4 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(5)}
              >
                {t("skip")}
              </Button>
            )}
            {step === TOTAL_STEPS ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed() || submitting}
                size="sm"
              >
                {submitting ? t("submitting") : t("submit")}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                size="sm"
              >
                {t("next")}
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-center text-sm text-destructive">
          {t("errorMessage")}
        </p>
      )}
    </div>
  );
}

/* --- Step Wrapper --- */

function StepWrapper({
  children,
  variants,
}: {
  children: React.ReactNode;
  variants: StepVariants;
}) {
  return (
    <motion.div
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/* --- Individual Steps --- */

type TranslateFn = ReturnType<typeof useTranslations>;

function WelcomeStep({
  t,
  onStart,
}: {
  t: TranslateFn;
  onStart: () => void;
}) {
  return (
    <div className="text-center space-y-6 py-8">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted">
        <Leaf className="size-8 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl">{t("welcomeHeading")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("welcomeDescription")}
        </p>
      </div>
      <Button onClick={onStart} className="w-full">
        {t("start")}
      </Button>
    </div>
  );
}

function CsatStep({
  t,
  value,
  onChange,
  onNext,
}: {
  t: TranslateFn;
  value: number | null;
  onChange: (v: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("q1Title")}
        </p>
        <p className="text-base">{t("q1Question")}</p>
      </div>
      <div className="flex justify-center gap-3">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => {
              onChange(rating);
              setTimeout(onNext, 300);
            }}
            className="group relative flex flex-col items-center gap-1"
            aria-label={`${rating} / 5`}
          >
            <span
              className={`flex size-12 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                value !== null && rating <= value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
            >
              <TeaLeafIcon className="size-6" />
            </span>
            <span className="text-xs text-muted-foreground">{rating}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WouldUseAgainStep({
  t,
  value,
  onChange,
}: {
  t: TranslateFn;
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("q2Title")}
        </p>
        <p className="text-base">{t("q2Question")}</p>
      </div>
      <div className="flex flex-col gap-3">
        {(["yes", "not_sure"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-lg border px-4 py-3 text-left text-sm transition-all duration-200 ${
              value === option
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {option === "yes" ? t("q2Yes") : t("q2No")}
          </button>
        ))}
      </div>
    </div>
  );
}

function BestAspectsStep({
  t,
  value,
  onChange,
}: {
  t: TranslateFn;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (aspect: string) => {
    onChange(
      value.includes(aspect)
        ? value.filter((a) => a !== aspect)
        : [...value, aspect]
    );
  };

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("q3Title")}
        </p>
        <p className="text-base">{t("q3Question")}</p>
        <p className="text-xs text-muted-foreground">{t("q3Multi")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {BEST_ASPECT_KEYS.map((key) => {
          const aspectValue = BEST_ASPECT_VALUES[key];
          const selected = value.includes(aspectValue);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(aspectValue)}
              className={`rounded-full border px-4 py-2 text-sm transition-all duration-200 ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
            >
              {t(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ImprovementStep({
  t,
  value,
  onChange,
}: {
  t: TranslateFn;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("q4Title")}
          <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
            ({t("q4Optional")})
          </span>
        </p>
        <p className="text-base">{t("q4Question")}</p>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("q4Placeholder")}
        rows={4}
        className="resize-none"
      />
    </div>
  );
}

function NpsStep({
  t,
  value,
  onChange,
}: {
  t: TranslateFn;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("q5Title")}
        </p>
        <p className="text-base">{t("q5Question")}</p>
      </div>
      <div>
        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange(i)}
              className={`flex h-10 items-center justify-center rounded-md text-sm font-medium transition-all duration-200 ${
                value === i
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
              aria-label={`${i}`}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between">
          <span className="text-xs text-muted-foreground">{t("q5Low")}</span>
          <span className="text-xs text-muted-foreground">{t("q5High")}</span>
        </div>
      </div>
    </div>
  );
}

function CompleteStep({ t }: { t: TranslateFn }) {
  return (
    <div className="text-center space-y-6 py-8">
      <FloatingLeaves />
      <div className="space-y-2">
        <h2 className="text-2xl">{t("completeHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("completeMessage")}</p>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link href="/">{t("completeBack")}</Link>
      </Button>
    </div>
  );
}

/* --- Icons & Decorations --- */

function TeaLeafIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.8 0 3.5-.5 5-1.3" />
      <path d="M17 8c-1.5 2-3 4-5 5.5" />
      <path d="M7 14c2-1 4-3 5-5.5" />
      <path d="M14 4c1 2 1.5 4 1 6" />
    </svg>
  );
}

function FloatingLeaves() {
  return (
    <div className="relative mx-auto h-16 w-32">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute text-muted-foreground/40"
          initial={{ opacity: 0, y: 0, x: i * 40 + 10, rotate: 0 }}
          animate={{
            opacity: [0, 1, 0],
            y: [0, -20, -40],
            rotate: [0, 15 * (i % 2 === 0 ? 1 : -1), 30 * (i % 2 === 0 ? 1 : -1)],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            delay: i * 0.8,
            ease: "easeOut",
          }}
        >
          <Leaf className="size-5" />
        </motion.div>
      ))}
    </div>
  );
}
