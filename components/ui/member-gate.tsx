import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export async function MemberGate() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  return (
    <div className="mt-8 py-12 text-center border-t border-border">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
        {tCommon("memberOnly")}
      </p>
      <p className="text-muted-foreground text-sm mb-8 max-w-md mx-auto">
        {t("memberOnlyDescription")}
      </p>
      <Button variant="outline" asChild>
        <a href={`/api/auth/login?locale=${locale}`}>{tCommon("login")}</a>
      </Button>
    </div>
  );
}
