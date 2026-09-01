"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { SAFETY_TAGS, type SafetyTag } from "@/lib/cdp/cup-feedback";
import { usePessimisticMutation } from "@/lib/interaction/use-optimistic-mutation";
import { cn } from "@/lib/utils";

/**
 * 「避けたいもの」を申告する画面の本体（顧客プロファイル 第1段 ⑥）。
 *
 * 設計正本: rev.3.2 §6 第1段 ⑥ /「受け口は実装済み、画面だけ無い」/
 * §2「絶対に越えない線」/ §4「どのオフを選んでも、安全申告は絶対に効き続ける」。
 *
 * ## 3 つの区分しか置かない（自由記入を置かない理由・重要）
 *
 * 設計 §2 の表は「チェック + 自由記入」と書いているが、**第1段では自由記入を
 * 置かない**。理由は 2 つで、どちらも「置くと嘘になる」side である:
 *
 *   1. **読む人がいない。** 自由記入を保存できる場所は web-app の Firestore だが、
 *      お茶を選んでいるのは cx-agent 側で、そこへ渡る経路が第1段には無い。
 *      書けるのに効かない欄は、設計 §4 が最も嫌う「オフにしたのに止まっていない」
 *      と同じ形になる。
 *   2. **要配慮個人情報が書かれうる。** 病名・服薬は取得も保存も禁止（§2 の禁止表 /
 *      LINE 公式アカウント API 利用規約 第5条）。自由欄は書かれた瞬間に線を越える。
 *
 * よって書ける内容は閉じた 3 区分に限り、それ以外は**人が読む経路**（お問い合わせ）
 * へ案内する。第2段で解除（`safety.cleared`）と併せて設計し直す。
 *
 * ## 取り消しは、この画面ではできない（正確に書く）
 *
 * cx-agent 側は安全申告を「減らす方向に畳まない」。この画面だけでチェックを外せる
 * ようにすると、画面からは消えたのにお茶は外れ続ける、という嘘になる。だから
 * **申告済みの区分は押せない状態で残し**、取り消しの経路を文章で示す。
 * 「止まる範囲を曖昧にしない」（§4）をそのまま画面に写したもの。
 */
export interface SafetyFormProps {
  /** すでに申告済みの区分（サーバで解決済み）。 */
  declared: SafetyTag[];
}

export function SafetyForm({ declared }: SafetyFormProps) {
  const t = useTranslations("safety");
  const [saved, setSaved] = useState<SafetyTag[]>(declared);
  const [selected, setSelected] = useState<SafetyTag[]>([]);
  const [consent, setConsent] = useState(false);
  const [failed, setFailed] = useState(false);

  const submission = usePessimisticMutation<SafetyTag[]>({
    operation: "safety.declare",
    mutationClass: "pessimistic-form",
    send: async (tags) => {
      const res = await fetch("/api/user/safety", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, consent: true }),
      });
      if (!res.ok) throw new Error(`safety responded ${res.status}`);
      const body = (await res.json()) as { tags?: string[] };
      setSaved((body.tags ?? []).filter((tag): tag is SafetyTag =>
        (SAFETY_TAGS as readonly string[]).includes(tag),
      ));
      setSelected([]);
      setConsent(false);
      return body;
    },
    onFailure: () => setFailed(true),
  });

  const { run } = submission;

  const toggle = useCallback((tag: SafetyTag) => {
    setFailed(false);
    setSelected((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag],
    );
  }, []);

  const toggleConsent = useCallback(() => {
    setFailed(false);
    setConsent((current) => !current);
  }, []);

  const submit = useCallback(() => {
    if (selected.length === 0 || !consent) return;
    setFailed(false);
    void run(selected);
  }, [selected, consent, run]);

  return (
    <div data-slot="safety-form" className="space-y-8">
      <div className="flex flex-col gap-2">
        {SAFETY_TAGS.map((tag) => {
          const isDeclared = saved.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              data-slot="safety-tag"
              role="checkbox"
              aria-checked={isDeclared || selected.includes(tag)}
              aria-disabled={isDeclared}
              disabled={isDeclared}
              onClick={() => toggle(tag)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left text-sm",
                isDeclared
                  ? "border-border bg-muted text-muted-foreground"
                  : selected.includes(tag)
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground",
              )}
            >
              <span className="block">{t(`tag_${tag}`)}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {isDeclared ? t("alreadyDeclared") : t(`tagNote_${tag}`)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-4">
        <p className="text-sm">{t("consentHeading")}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("consentBody")}
        </p>
        <button
          type="button"
          data-slot="safety-consent"
          role="checkbox"
          aria-checked={consent}
          onClick={toggleConsent}
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-left text-xs",
            consent
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground",
          )}
        >
          {t("consentCheck")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-slot="safety-submit"
          data-pending={submission.isPending ? "true" : undefined}
          disabled={selected.length === 0 || !consent || submission.isPending}
          onClick={submit}
        >
          {submission.isPending ? t("sending") : t("submit")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("addOnlyNote")}</p>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("otherThingsLead")}{" "}
        <Link href="/contact" className="underline">
          {t("otherThingsLink")}
        </Link>
      </p>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("sendFailed")}
        </p>
      )}
    </div>
  );
}
