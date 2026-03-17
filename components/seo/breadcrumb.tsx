import { Link } from "@/i18n/navigation";
import { BreadcrumbJsonLd } from "./json-ld";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({
  items,
  baseUrl = "https://elxea.com",
  locale = "ja",
}: {
  items: BreadcrumbItem[];
  baseUrl?: string;
  locale?: string;
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
      <nav aria-label="Breadcrumb" className="mb-8">
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
