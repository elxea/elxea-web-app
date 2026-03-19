"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BusinessForm() {
  const t = useTranslations("contactBusiness");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [inquiryType, setInquiryType] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSending(true);
    setError(false);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/contact/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: formData.get("companyName"),
          name: formData.get("name"),
          email: formData.get("email"),
          inquiryType,
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
        <Label htmlFor="companyName">{t("companyName")}</Label>
        <Input
          type="text"
          id="companyName"
          name="companyName"
          required
          disabled={sending}
        />
      </div>

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
        <Label>{t("inquiryType")}</Label>
        <Select
          value={inquiryType}
          onValueChange={setInquiryType}
          required
          disabled={sending}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("inquiryTypePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="wholesale">{t("inquiryWholesale")}</SelectItem>
            <SelectItem value="press">{t("inquiryPress")}</SelectItem>
            <SelectItem value="other">{t("inquiryOther")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">{t("message")}</Label>
        <Textarea
          id="message"
          name="message"
          rows={6}
          required
          disabled={sending}
          className="resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{t("error")}</p>
      )}

      <Button type="submit" variant="outline" disabled={sending || !inquiryType}>
        {sending ? <Loader2 className="size-4 animate-spin" /> : t("submit")}
      </Button>
    </form>
  );
}
