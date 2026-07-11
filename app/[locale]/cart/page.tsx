import { useTranslations } from "next-intl";
import { CartContent } from "@/components/cart/cart-content";

export default function CartPage() {
  const t = useTranslations("common");

  return (
    <div className="section-narrow py-20">
      <h1 className="mb-4">{t("cart")}</h1>
      <p className="text-muted-foreground text-sm mb-12">カートの中身</p>
      <CartContent />
    </div>
  );
}
