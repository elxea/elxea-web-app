import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCollectionByHandle } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  try {
    const collection = await getCollectionByHandle(handle);
    if (!collection) return {};
    return {
      title: collection.title,
      description: collection.seo.description || collection.description?.slice(0, 160),
      openGraph: {
        title: collection.title,
        description: collection.seo.description || collection.description?.slice(0, 160),
        images: collection.image ? [{ url: collection.image.url }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const t = await getTranslations("collection");

  let collection;
  try {
    collection = await getCollectionByHandle(handle);
  } catch {
    return (
      <div className="section-wide">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!collection) notFound();

  return (
    <div className="section-wide py-20 md:px-20 md:py-24">
      <div className="mb-16">
        <h1 className="page-title mb-4">{collection.title}</h1>
        {collection.description && (
          <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed">
            {collection.description}
          </p>
        )}
      </div>
      <ProductGrid products={collection.products} />
    </div>
  );
}
