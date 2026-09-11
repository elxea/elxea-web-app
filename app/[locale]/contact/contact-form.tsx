"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * お問い合わせフォーム — Figma【R2: 確定版】`8109:46691` (PC) / `8109:46775` (SP)。
 *
 * R2 で「項目最小」に絞られた 4 項目だけを持つ。
 * - `お問い合わせの種類` (任意・select) …… R1 で別ページだった法人/取材を吸収する軸
 * - `お名前` / `メールアドレス` / `お問い合わせ内容` (必須)
 *
 * R1 にあった `件名` は R2 で廃止された (Figma に field が無い) ので落としている。
 * 種類だけ `必須` マークを持たず、代わりに 2 種の候補を注記で見せる
 * (Figma 8109:46695 の mark は「必須」ではなく候補の列挙)。
 *
 * 寸法の出どころ (Figma 実測):
 * - field 間 32 (space-y-8) / label→control 8 (mt-2)
 * - control 高さ PC 36 (`h-9`) / SP 44 (`h-11`) …… SP はタップ域 44 の下限
 * - textarea 高さ 200 (`h-50` = 12.5rem)
 * - 注記→ボタン 32 (mt-8) / ボタン PC 200x44 / SP 全幅 x44
 */

/** 送信先の振り分け軸。API 側 (`app/api/contact/route.ts`) の enum と対応。 */
const CATEGORIES = ["customer", "business"] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * label + 必須/注記マーク + control の 1 項目。
 * Figma 8109:46692 系。マークは label の右 8px (Label 既定の `gap-2`)。
 */
function FormRow({
  htmlFor,
  label,
  mark,
  children,
}: {
  htmlFor: string;
  label: string;
  mark?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className={cn(bodySmClass, "items-baseline text-foreground")}>
        {label}
        {mark ? <span className={cn(captionClass, "text-muted-foreground")}>{mark}</span> : null}
      </Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function ContactForm() {
  const t = useTranslations("contact");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSending(true);
    setError(false);

    const formData = new FormData(e.currentTarget);
    const category = String(formData.get("category") ?? "");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          message: formData.get("message"),
          // 未選択 (placeholder) のときは送らない。API 側の既定 (customer) に委ねる。
          ...(CATEGORIES.includes(category as Category) ? { category } : {}),
        }),
      });

      if (!res.ok) throw new Error("Failed to send");
      setSubmitted(true);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  // Figma に送信後の状態指定が無いため、静的ページ共通の「罫線 1 本」言語で最小構成にする
  // (カード・影は R2 の静的ページで一度も使われていない)。
  if (submitted) {
    return (
      <p
        role="status"
        className={cn(bodySmClass, "border-t border-b border-border py-8 text-foreground")}
      >
        {t("success")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate={false} data-slot="contact-form">
      <div className="space-y-8">
        <FormRow htmlFor="category" label={t("category")} mark={t("categoryHint")}>
          <NativeSelect
            id="category"
            name="category"
            defaultValue=""
            disabled={sending}
            wrapperClassName="w-full"
            className="h-11 lg:h-9"
          >
            <NativeSelectOption value="" disabled>
              {t("categoryPlaceholder")}
            </NativeSelectOption>
            <NativeSelectOption value="customer">{t("categoryCustomer")}</NativeSelectOption>
            <NativeSelectOption value="business">{t("categoryBusiness")}</NativeSelectOption>
          </NativeSelect>
        </FormRow>

        <FormRow htmlFor="name" label={t("name")} mark={t("required")}>
          <Input
            type="text"
            id="name"
            name="name"
            required
            autoComplete="name"
            placeholder={t("namePlaceholder")}
            disabled={sending}
            className="h-11 lg:h-9"
          />
        </FormRow>

        <FormRow htmlFor="email" label={t("email")} mark={t("required")}>
          <Input
            type="email"
            id="email"
            name="email"
            required
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            disabled={sending}
            className="h-11 lg:h-9"
          />
        </FormRow>

        <FormRow htmlFor="message" label={t("message")} mark={t("required")}>
          <Textarea
            id="message"
            name="message"
            required
            placeholder={t("messagePlaceholder")}
            disabled={sending}
            className="h-50 resize-none"
          />
        </FormRow>
      </div>

      {error ? (
        <p role="alert" className={cn(bodySmClass, "mt-4 text-destructive")}>
          {t("error")}
        </p>
      ) : null}

      {/* Figma 8109:46717 — フォーム下端から 16 */}
      <p className={cn(captionClass, "mt-4 text-muted-foreground")}>
        {t.rich("privacyNote", {
          policy: (chunks) => (
            <Link
              href="/legal/privacy"
              className="text-foreground underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>

      {/* Figma 8109:46718 / 8109:46802 — PC 200x44 / SP 全幅 x44。
          `cta` トークンは 43px なので、タップ域 44 の下限に合わせて `h-11` を明示する
          (`component.button.height.cta` を 44 に寄せるのは DS 側の別案件)。 */}
      <Button type="submit" size="cta" disabled={sending} className="mt-8 h-11 w-full lg:w-50">
        {sending ? <Spinner /> : t("submit")}
      </Button>
    </form>
  );
}
