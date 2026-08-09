import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/**
 * `[locale]` 配下の not-found 境界。`notFound()` を呼んだページはこの UI を描画する。
 *
 * ## この境界より上に Suspense 境界 (`loading.tsx`) を置かないこと
 *
 * `app/[locale]/loading.tsx` があると、Next.js は「レイアウト + loading フォールバック」
 * のシェルを **HTTP ステータス 200 のまま先に flush** し、そのあとページ本体を
 * ストリームする。ページが `notFound()` を投げるのはシェル送出後なので、
 * ステータスを 404 に差し替えられず **soft-404 (200 + not-found DOM)** になる。
 *
 * 実測 (2026-08-09 / C15-1・Next.js 16.2.1 / `next start`):
 * - `loading.tsx` あり → 動的ルート 13 本すべて不存在 slug で 200 + not-found DOM
 * - `loading.tsx` なし → 同じ 13 本が 404
 * - `generateMetadata` 側で `notFound()` を投げても 200 のまま
 *   (metadata もストリームされるため間に合わない) — 検証済みで不採用
 *
 * したがって `[locale]` (およびその配下で動的詳細ルートを含む segment) に
 * `loading.tsx` を再追加してはいけない。ローディング表示が必要なときは、
 * 「存在チェックが終わったあとの重い部分」だけをページ内の `<Suspense>` で包む
 * (シェル flush をページの 404 判定より後ろに保つ)。
 */
export default function NotFound() {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-6">404</p>
      <h1 className="mb-4">{t("notFound")}</h1>
      <p className="text-muted-foreground text-sm mb-10 max-w-md">
        {t("notFoundDescription")}
      </p>
      <Button variant="outline" asChild>
        <Link href="/">{t("backToHome")}</Link>
      </Button>
    </div>
  );
}
