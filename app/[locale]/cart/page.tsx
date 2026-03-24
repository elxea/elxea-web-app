import { useTranslations } from "next-intl";
import { CartContent } from "@/components/cart/cart-content";

export default function CartPage() {
  const t = useTranslations("common");

  return (
    <div className="section-narrow">
      <h1 className="mb-12">{t("cart")}</h1>
      <CartContent />
    </div>
  );
}
