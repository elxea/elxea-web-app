import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-[12px] text-light uppercase tracking-wider mb-6">404</p>
      <h1 className="text-2xl mb-4">{t("notFound")}</h1>
      <p className="text-muted text-[14px] mb-10 max-w-md">
        {t("notFoundDescription")}
      </p>
      <Link
        href="/"
        className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
      >
        {t("backToHome")}
      </Link>
    </div>
  );
}
