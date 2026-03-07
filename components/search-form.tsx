"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("common");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/${locale}/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} role="search">
      <div className="relative">
        <label htmlFor="search-input" className="sr-only">{t("search")}</label>
        <input
          id="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="w-full border-b border-charcoal bg-transparent py-4 text-2xl font-light outline-none placeholder:text-light"
          autoFocus
        />
      </div>
    </form>
  );
}
