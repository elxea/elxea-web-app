import Image from "next/image";
import { useTranslations } from "next-intl";
import { urlFor } from "@/sanity/lib/image";
import { Link } from "@/i18n/navigation";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { formatNetWeight, type NetWeightValue } from "@/lib/format-net-weight";

interface TeaSpecCardProps {
  tea: {
    _id: string;
    slug: { current: string };
    displayName: string;
    productNumber: string;
    category: string;
    variety: string;
    season: string;
    origin: string;
    /** 実データは文字列 `"50g"` / schema どおりの数値 `50` の両方があり得る。 */
    netWeight: NetWeightValue;
    photo?: { asset: object; alt?: string };
  };
}

export function TeaSpecCard({ tea }: TeaSpecCardProps) {
  const t = useTranslations("elxeaJournal");

  return (
    <div className="border border-border bg-background rounded-md overflow-hidden">
      {/* Photo */}
      <div className="aspect-square bg-muted overflow-hidden">
        {tea.photo?.asset ? (
          <Image
            src={urlFor(tea.photo).width(400).height(400).url()}
            alt={tea.photo.alt || tea.displayName}
            width={400}
            height={400}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="w-full h-full object-cover"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </div>

      {/* Spec table */}
      <dl className="px-4 py-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("no")}</dt>
          <dd className="text-right">{tea.productNumber}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("category")}</dt>
          <dd className="text-right">{tea.category}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("name")}</dt>
          <dd className="text-right">{tea.displayName}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("variety")}</dt>
          <dd className="text-right">{tea.variety}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("season")}</dt>
          <dd className="text-right">{tea.season}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("origin")}</dt>
          <dd className="text-right">{tea.origin}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("netWeight")}</dt>
          <dd className="text-right">{formatNetWeight(tea.netWeight)}</dd>
        </div>
      </dl>

      {/* Detail link */}
      <div className="border-t border-border">
        <Link
          href={`/tea-menu/${tea.slug.current}`}
          className="flex items-center justify-between px-4 py-2.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          <span>{t("teaDetailLink")}</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
