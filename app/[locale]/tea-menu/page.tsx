import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/ui/image-card";
import { TEA_MENUS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function TeaMenuPage() {
  const t = useTranslations("teaMenu");

  return (
    <div className="section-wide">
      {/* 変A: 左寄せ editorial header (Figma 6639:13048) */}
      <div className="mb-12 md:mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Tea Menu
        </p>
        <h1 className="mb-4">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{t("description")}</p>
      </div>
      <TeaMenuList />
    </div>
  );
}

async function TeaMenuList() {
  const locale = await getLocale();
  const t = await getTranslations("teaMenu");

  try {
    const client = getClient();
    const items = await client.fetch(TEA_MENUS_QUERY, { language: locale });

    if (!items || items.length === 0) {
      return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
        {items.map(
          (item: {
            _id: string;
            slug: { current: string };
            photo?: { asset: object; alt?: string };
            displayName: string;
            category: string;
            variety: string;
            origin: string;
            color?: string;
          }) => (
            <Link
              key={item._id}
              href={`/tea-menu/${item.slug.current}`}
              className="group block"
            >
              <ImageCard
                image={item.photo?.asset ? urlFor(item.photo).width(600).height(400).url() : undefined}
                alt={item.photo?.alt || item.displayName}
                className="mb-3"
                style={item.color ? { backgroundColor: item.color } : undefined}
                hover
              />
              {/* 変A: カードテキスト 左寄せ (Figma Card Text 6639:13149) */}
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
                  {item.category}
                </p>
                <h2 className="text-base font-medium leading-relaxed group-hover:underline underline-offset-4">
                  {item.displayName}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {item.variety} · {item.origin}
                </p>
              </div>
            </Link>
          )
        )}
      </div>
    );
  } catch {
    return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;
  }
}
