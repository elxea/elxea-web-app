import { useTranslations } from "next-intl";

export default function AccountPage() {
  const t = useTranslations("common");

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">{t("account")}</h1>
      <p className="text-gray-500">Shopify Customer Account API 接続後にマイページが表示されます</p>
    </div>
  );
}
