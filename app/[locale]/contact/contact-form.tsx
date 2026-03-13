"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function ContactForm() {
  const t = useTranslations("contact");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSending(true);
    setError(false);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          subject: formData.get("subject"),
          message: formData.get("message"),
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
          disabled={sending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          type="email"
          id="email"
          name="email"
          required
          disabled={sending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">{t("subject")}</Label>
        <Input
          type="text"
          id="subject"
          name="subject"
          required
          disabled={sending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">{t("message")}</Label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          disabled={sending}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{t("error")}</p>
      )}

      <Button type="submit" variant="outline" disabled={sending}>
        {sending ? <Loader2 className="size-4 animate-spin" /> : t("submit")}
      </Button>
    </form>
  );
}
