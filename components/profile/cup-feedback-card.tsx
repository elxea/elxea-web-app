"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  CUP_ASPECTS,
  CUP_VERDICTS,
  CUP_VERDICT_LABEL_KEYS,
  asksAspect,
  type CupAspect,
  type CupVerdict,
} from "@/lib/cdp/cup-feedback";
import { usePessimisticMutation } from "@/lib/interaction/use-optimistic-mutation";
import { cn } from "@/lib/utils";

/**
 * 届いた一杯への答えを 1 杯ぶん受ける札（顧客プロファイル 第1段 ①）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ① / §7 択一 #4 /
 * §4 R2（数値・星・点数・順位・バッジを出さない）。
 *
 * ## 星も数字も出さない（択一 #4 の確定条件）
 *
 * 5 段階だが、画面に出るのは**記述語だけ**である。星の列も 1〜5 の数字も
 * 「あと何件」も出さない。この札が持っているのは `CupVerdict`（語）で、
 * 1-5 への変換はサーバ側にしかない — **画面は数値を知らない**。
 *
 * ## 押した瞬間に効くもの / 待つもの を混ぜない（憲章 R9）
 *
 * 選ぶ（`sync-dom`）は state だけで完結し、ネットワークを待たない。待つのは
 * 送信の 1 手（`pessimistic-form`）だけ。診断フォームと同じ作り分けにしてある。
 *
 * ## 「いまは答えない」は否定ではない
 *
 * 設計 §2「無回答は第 3 の値。否定信号にしない」。押すと `flow.survey_decline`
 * が 1 行積まれるだけで、見立ては 1 ミリも動かない。押した人を追いかけない
 * （その一杯は二度と聞かない）。
 */
export interface CupFeedbackCardProps {
  productNo: string;
  name: string;
  issueRef: string;
  /** 答え終わったことを親に伝える（札を畳むのは親の仕事）。 */
  onSettled: (productNo: string) => void;
}

export function CupFeedbackCard({
  productNo,
  name,
  issueRef,
  onSettled,
}: CupFeedbackCardProps) {
  const t = useTranslations("thisMonth");
  const [verdict, setVerdict] = useState<CupVerdict | null>(null);
  const [aspect, setAspect] = useState<CupAspect | null>(null);
  const [failed, setFailed] = useState(false);

  const submission = usePessimisticMutation<
    { verdict: CupVerdict; aspect: CupAspect | null } | { decline: true }
  >({
    operation: "cup-feedback.submit",
    mutationClass: "pessimistic-form",
    send: async (input) => {
      const body =
        "decline" in input
          ? { productNo, issueRef, decline: true as const }
          : {
              productNo,
              issueRef,
              verdict: input.verdict,
              ...(input.aspect ? { aspect: input.aspect } : {}),
            };
      const res = await fetch("/api/user/cup-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`cup-feedback responded ${res.status}`);
      onSettled(productNo);
      return await res.json();
    },
    /* 失敗の記録は hook 側が残す。ここは言い直しだけ（黙って戻さない）。 */
    onFailure: () => setFailed(true),
  });

  const { run } = submission;

  const choose = useCallback((next: CupVerdict) => {
    setFailed(false);
    setVerdict(next);
    /* 合った側に倒し直したら「どこが」は取り消す（残ると聞いていない答えが送られる）。 */
    if (!asksAspect(next)) setAspect(null);
  }, []);

  const chooseAspect = useCallback((next: CupAspect) => {
    setFailed(false);
    setAspect((current) => (current === next ? null : next));
  }, []);

  const submit = useCallback(() => {
    if (!verdict) return;
    setFailed(false);
    void run({ verdict, aspect });
  }, [verdict, aspect, run]);

  const decline = useCallback(() => {
    setFailed(false);
    void run({ decline: true });
  }, [run]);

  return (
    <section
      data-slot="cup-feedback-card"
      className="rounded-lg border border-border bg-background px-6 py-6 sm:px-8"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("cardOverline")}
      </p>
      <h2 className="mt-2 text-lg">{name}</h2>
      <p className="mt-3 text-sm text-muted-foreground">{t("cardQuestion")}</p>

      <div className="mt-5 flex flex-col gap-2">
        {CUP_VERDICTS.map((value) => (
          <button
            key={value}
            type="button"
            data-slot="cup-verdict"
            aria-pressed={verdict === value}
            onClick={() => choose(value)}
            className={cn(
              "rounded-lg border px-4 py-3 text-left text-sm",
              verdict === value
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground",
            )}
          >
            {t(CUP_VERDICT_LABEL_KEYS[value])}
          </button>
        ))}
      </div>

      {verdict !== null && asksAspect(verdict) && (
        <div data-slot="cup-aspect" className="mt-6">
          <p className="text-sm">{t("aspectQuestion")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("aspectOptional")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CUP_ASPECTS.map((value) => (
              <button
                key={value}
                type="button"
                data-slot="cup-aspect-choice"
                aria-pressed={aspect === value}
                onClick={() => chooseAspect(value)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm",
                  aspect === value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground",
                )}
              >
                {t(`aspect_${value}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button
          data-slot="cup-submit"
          data-pending={submission.isPending ? "true" : undefined}
          disabled={verdict === null || submission.isPending}
          onClick={submit}
        >
          {submission.isPending ? t("sending") : t("send")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-slot="cup-decline"
          data-pending={submission.isPending ? "true" : undefined}
          disabled={submission.isPending}
          onClick={decline}
        >
          {t("declineNow")}
        </Button>
      </div>

      {failed && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t("sendFailed")}
        </p>
      )}
    </section>
  );
}
