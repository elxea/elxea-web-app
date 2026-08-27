"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { InputUnderline } from "@/components/search/search-panel";
import { useOptimisticNavigation } from "@/hooks/use-optimistic-navigation";
import { trackSearch } from "@/lib/analytics";

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("common");
  const ts = useTranslations("search");

  /**
   * 送信してから結果が出るまでの進行を出す (網羅表 2026-08-27 / G10)。
   *
   * 検索は結果をサーバが決めるので**先に見せられる結果が無い**。ここで直せる
   * のは「押したことが伝わらない」ほうで、以前は `router.push` を呼ぶだけ
   * だった — Enter を押しても画面は 1 ドットも変わらないまま往復を待っていた。
   *
   * 通り道は絞り込み・並び替えと同じ `useOptimisticNavigation`。楽観値
   * (`nav.value`) は使わない (入力欄は手元の `query` が正) が、遷移を
   * `startTransition` の中で起こすことで `isNavigating` が押した瞬間に立つ。
   */
  const nav = useOptimisticNavigation(initialQuery);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const submitted = query.trim();
    if (!submitted) return;
    trackSearch(submitted);
    nav.navigate(submitted, () =>
      router.push(`/${locale}/search?q=${encodeURIComponent(submitted)}`)
    );
  }

  return (
    <form onSubmit={handleSubmit} role="search" aria-busy={nav.isNavigating}>
      <Label htmlFor="search-input" className="sr-only">{t("search")}</Label>
      {/* Figma 6936:126 Input Underline。以前はここに shadcn Input を border-b で
          上書きしたインライン実装があり、SearchPanel 側と二重になっていた。
          C2 R4 で共有部品 InputUnderline に統合 (正本は components/search/search-panel.tsx)。
          type は既存挙動を変えないよう text のまま (部品の既定は search)。

          進行の印は入力欄の中に重ねる。行を足すと、出た瞬間に下の結果が
          押し下げられて読んでいる場所が動く。 */}
      <div className="relative">
        <InputUnderline
          id="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ts("placeholder")}
          autoFocus
          className={nav.isNavigating ? "pr-8" : undefined}
        />
        {nav.isNavigating ? (
          <Loader2Icon
            aria-hidden="true"
            data-slot="search-progress"
            className="pointer-events-none absolute top-1/2 right-0 size-5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>
    </form>
  );
}
