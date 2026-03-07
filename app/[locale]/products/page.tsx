import { useTranslations } from "next-intl";
import { getProducts } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";

export default function ProductsPage() {
  const t = useTranslations("common");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-12">{t("products")}</h1>
      <ProductsContent />
    </div>
  );
}

async function ProductsContent() {
  try {
    const { products } = await getProducts({ first: 20 });
    return <ProductGrid products={products} />;
  } catch {
    return (
      <p className="text-muted text-[14px]">
        商品を読み込めませんでした。Shopify API の接続設定を確認してください。
      </p>
    );
  }
}
