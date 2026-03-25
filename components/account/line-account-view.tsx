import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type LineAccountViewProps = {
  displayName: string;
  locale: string;
};

/**
 * P7-fix: Account page view for LINE-only authenticated users.
 *
 * When a user logs in via LINE but has no Shopify session, they can still
 * access the account page. This view shows:
 * 1. Their LINE display name and connection status
 * 2. A prompt to also connect their email (Shopify) for full features
 * 3. Available features (chat, browsing) and locked features (orders, subscriptions)
 * 4. Logout link
 */
export async function LineAccountView({
  displayName,
  locale,
}: LineAccountViewProps) {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");

  return (
    <div className="section-narrow">
      {/* User info */}
      <div className="mb-12">
        <h1 className="mb-2">{tCommon("account")}</h1>
        <p className="text-sm text-foreground">{displayName}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("lineConnected")}
        </p>

        <Button
          variant="link"
          className="mt-6 p-0 h-auto text-muted-foreground"
          asChild
        >
          <a href={`/api/auth/logout?locale=${locale}`}>{tCommon("logout")}</a>
        </Button>
      </div>

      {/* Connect Shopify prompt */}
      <section className="mb-12 rounded-lg border border-border p-6">
        <h2 className="text-base mb-3">{t("connectShopifyHeading")}</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {t("connectShopifyDescription")}
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/auth/login?locale=${locale}`}>
            {t("connectShopifyButton")}
          </a>
        </Button>
      </section>

      {/* Available features */}
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("availableFeatures")}
        </h2>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="text-foreground">&#10003;</span>
            {t("featureChat")}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-foreground">&#10003;</span>
            {t("featureBrowse")}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-foreground">&#10003;</span>
            {t("featureLineNotifications")}
          </li>
        </ul>
      </section>

      {/* Locked features */}
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("lockedFeatures")}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t("lockedFeaturesDescription")}
        </p>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="opacity-40">&#10003;</span>
            {t("featureOrders")}
          </li>
          <li className="flex items-center gap-2">
            <span className="opacity-40">&#10003;</span>
            {t("featureSubscriptions")}
          </li>
          <li className="flex items-center gap-2">
            <span className="opacity-40">&#10003;</span>
            {t("featureFavorites")}
          </li>
        </ul>
      </section>

      {/* Quick links */}
      <Separator />
      <section className="pt-8">
        <div className="flex flex-wrap gap-4">
          <Button
            variant="link"
            className="p-0 h-auto text-muted-foreground"
            asChild
          >
            <Link href="/products">{tCommon("products")}</Link>
          </Button>
          <Button
            variant="link"
            className="p-0 h-auto text-muted-foreground"
            asChild
          >
            <Link href="/journal">{tCommon("journal")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
