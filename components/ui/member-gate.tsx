import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { isAuthenticated } from "@/lib/shopify/auth";
import type { MembershipTier } from "@/lib/shopify/customer";
import { Link } from "@/i18n/navigation";

export async function MemberGate({
  requiredTier = "standard",
}: {
  requiredTier?: MembershipTier;
}) {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const loggedIn = await isAuthenticated();

  const tierLabel: Record<string, string> = {
    standard: t("tierStandard"),
    premium: t("tierPremium"),
  };

  return (
    <div className="mt-8 py-12 text-center border-t border-border">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
        {tierLabel[requiredTier] ?? tCommon("memberOnly")}
      </p>
      <p className="text-muted-foreground text-sm mb-8 max-w-md mx-auto">
        {loggedIn ? t("tierUpgradeDescription") : t("memberOnlyDescription")}
      </p>
      {loggedIn ? (
        <Button variant="outline" asChild>
          {/* メンバーシップは R2 でページごと廃止され、プラン選択は定期便LP に
              一本化された (決定 2026-08-08 / Figma 7973:42298)。転送を 1 回
              挟まずに済むよう、導線は直接 LP を指す。 */}
          <Link href="/subscription">{t("viewPlans")}</Link>
        </Button>
      ) : (
        <Button variant="outline" asChild>
          <a href={`/api/auth/login?locale=${locale}`}>{tCommon("login")}</a>
        </Button>
      )}
    </div>
  );
}
