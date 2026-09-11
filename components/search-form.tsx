"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { InputUnderline } from "@/components/search/search-panel";
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
      {/* Figma 6936:126 Input Underline。以前はここに shadcn Input を border-b で
          上書きしたインライン実装があり、SearchPanel 側と二重になっていた。
          C2 R4 で共有部品 InputUnderline に統合 (正本は components/search/search-panel.tsx)。
          type は既存挙動を変えないよう text のまま (部品の既定は search)。 */}
      <InputUnderline
        id="search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ts("placeholder")}
        autoFocus
      />
    </form>
  );
}
