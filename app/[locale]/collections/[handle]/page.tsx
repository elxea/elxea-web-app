import { notFound } from "next/navigation";
import { getCollectionByHandle } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  let collection;
  try {
    collection = await getCollectionByHandle(handle);
  } catch {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16">
        <p className="text-muted">コレクションを読み込めませんでした。</p>
      </div>
    );
  }

  if (!collection) notFound();

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-4">{collection.title}</h1>
      {collection.description && (
        <p className="text-muted text-[14px] mb-12 max-w-2xl">
          {collection.description}
        </p>
      )}
      <ProductGrid products={collection.products} />
    </div>
  );
}
