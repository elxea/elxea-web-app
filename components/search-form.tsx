"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackSearch } from "@/lib/analytics";

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("common");
  const ts = useTranslations("search");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      trackSearch(query.trim());
      router.push(`/${locale}/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} role="search">
      <Label htmlFor="search-input" className="sr-only">{t("search")}</Label>
      <Input
        id="search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ts("placeholder")}
        className="border-0 border-b border-foreground rounded-none bg-transparent py-4 h-auto text-2xl font-light placeholder:text-muted-foreground focus-visible:ring-0"
        autoFocus
      />
    </form>
  );
}
