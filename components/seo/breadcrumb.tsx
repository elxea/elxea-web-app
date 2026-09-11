import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { BreadcrumbJsonLd } from "./json-ld";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * パンくず (Figma「Breadcrumb (Module)」 6843:124)。
 *
 * `className` は**下余白の差し替え**のために受ける。既定の `mb-8` は既存ページ
 * (journal / products ほか) の実装値で、Figma がページ別に別の溝を持つ場合
 * (例: イベント詳細 6657:7931 は PC 64 / SP 40) にページ側から上書きする。
 * 既定値を変えていないので既存ページの表示は不変。
 */
export function Breadcrumb({
  items,
  baseUrl = "https://elxea.com",
  locale = "ja",
  className,
}: {
  items: BreadcrumbItem[];
  baseUrl?: string;
  locale?: string;
  className?: string;
}) {
  const jsonLdItems = items.map((item, i) => ({
    name: item.label,
    url: item.href
      ? `${baseUrl}/${locale}${item.href}`
      : `${baseUrl}/${locale}`,
  }));

  return (
    <>
      <BreadcrumbJsonLd items={jsonLdItems} />
      <nav aria-label="Breadcrumb" className={cn("mb-8", className)}>
        <ol className="flex items-center gap-2 text-xs text-muted-foreground">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              {item.href && i < items.length - 1 ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-foreground">{item.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
