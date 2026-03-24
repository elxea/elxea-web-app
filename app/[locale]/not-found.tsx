import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-6">404</p>
      <h1 className="mb-4">{t("notFound")}</h1>
      <p className="text-muted-foreground text-sm mb-10 max-w-md">
        {t("notFoundDescription")}
      </p>
      <Button variant="outline" asChild>
        <Link href="/">{t("backToHome")}</Link>
      </Button>
    </div>
  );
}
