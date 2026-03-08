"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function ContactForm() {
  const t = useTranslations("contact");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // TODO: Integrate with email service (e.g., Resend, SendGrid, or form service)
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-sm text-foreground">{t("success")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          type="text"
          id="name"
          name="name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          type="email"
          id="email"
          name="email"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">{t("subject")}</Label>
        <Input
          type="text"
          id="subject"
          name="subject"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">{t("message")}</Label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
        />
      </div>

      <Button type="submit" variant="outline">
        {t("submit")}
      </Button>
    </form>
  );
}
