import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function HomePage() {
  const t = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="flex items-center justify-center min-h-[70vh] px-6">
        <div className="text-center max-w-xl">
          <p className="text-[12px] text-muted uppercase tracking-[0.2em] mb-6">
            Specialty Coffee & Tea
          </p>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-6">
            elxea
          </h1>
          <p className="text-muted text-[14px] leading-relaxed mb-10">
            {t("home.hero")}
          </p>
          <Link
            href="/products"
            className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
          >
            {t("common.products")}
          </Link>
        </div>
      </section>

      {/* Featured Products */}
      <section className="max-w-7xl mx-auto px-6 py-section">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.featuredProducts")}</h2>
          <Link
            href="/products"
            className="text-[13px] text-muted hover:text-charcoal transition-colors"
          >
            {t("common.viewAll")} →
          </Link>
        </div>
        <FeaturedProducts />
      </section>

      {/* Journal */}
      <section className="max-w-7xl mx-auto px-6 py-section">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.latestJournal")}</h2>
          <Link
            href="/journal"
            className="text-[13px] text-muted hover:text-charcoal transition-colors"
          >
            {t("common.viewAll")} →
          </Link>
        </div>
        <p className="text-muted text-[14px]">
          {t("home.journalPlaceholder")}
        </p>
      </section>

      {/* Events */}
      <section className="max-w-7xl mx-auto px-6 py-section">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.upcomingEvents")}</h2>
          <Link
            href="/events"
            className="text-[13px] text-muted hover:text-charcoal transition-colors"
          >
            {t("common.viewAll")} →
          </Link>
        </div>
        <p className="text-muted text-[14px]">
          {t("home.eventsPlaceholder")}
        </p>
      </section>
    </>
  );
}

async function FeaturedProducts() {
  try {
    const { getProducts } = await import("@/lib/shopify");
    const { ProductGrid } = await import(
      "@/components/product/product-grid"
    );
    const { products } = await getProducts({ first: 6 });
    return <ProductGrid products={products} />;
  } catch {
    const { getTranslations } = await import("next-intl/server");
    const t = await getTranslations("home");
    return (
      <p className="text-muted text-[14px]">
        {t("productsPlaceholder")}
      </p>
    );
  }
}
