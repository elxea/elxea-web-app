import { getTranslations, getLocale } from "next-intl/server";
import { getCustomerFromSession, getSubscriptionsFromSession } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { Separator } from "@/components/ui/separator";
import type { MembershipTier } from "@/lib/shopify/customer";
import { DashboardSummary } from "@/components/account/dashboard-summary";
import { FavoritesSection } from "@/components/account/favorites-section";
import { FollowsSection } from "@/components/account/follows-section";
import { EventsSection } from "@/components/account/events-section";

function formatPrice(amount: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(parseFloat(amount));
}

function formatDate(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AccountPage() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  let customer = null;
  try {
    customer = await getCustomerFromSession();
  } catch {
    // fall through to login required
  }

  if (!customer) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="mb-6">{tCommon("account")}</h1>
        <p className="text-muted-foreground mb-8">{t("loginRequired")}</p>
        <Button variant="outline" asChild>
          <a href={`/api/auth/login?locale=${locale}`}>{tCommon("login")}</a>
        </Button>
      </div>
    );
  }

  const displayName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  const email = customer.emailAddress?.emailAddress;
  const orders = customer.orders?.edges ?? [];

  // Fetch subscriptions for summary count (graceful fallback if API doesn't support it)
  let subscriptionCount = 0;
  try {
    const subscriptions = await getSubscriptionsFromSession();
    subscriptionCount = subscriptions.length;
  } catch {
    // Subscription API may not be available
  }

  // Compute membership tier from already-fetched data (avoid extra API calls)
  let membershipTier: MembershipTier = "none";
  if (customer.tags) {
    if (customer.tags.includes("member-premium")) membershipTier = "premium";
    else if (customer.tags.includes("member-standard") || customer.tags.includes("member")) membershipTier = "standard";
  }
  if (membershipTier === "none" && subscriptionCount > 0) {
    membershipTier = "standard";
  }

  const tierLabels: Record<MembershipTier, string> = {
    none: t("tierNone"),
    standard: t("tierStandard").replace(/限定$/, "").replace(/ Only$/, ""),
    premium: t("tierPremium").replace(/限定$/, "").replace(/ Only$/, ""),
  };

  return (
    <div className="section-narrow">
      {/* Customer info */}
      <div className="mb-12">
        <h1 className="mb-2">{tCommon("account")}</h1>
        {displayName && (
          <p className="text-sm text-foreground">{displayName}</p>
        )}
        {email && <p className="text-sm text-muted-foreground">{email}</p>}

        <Button variant="link" className="mt-6 p-0 h-auto text-muted-foreground" asChild>
          <a href={`/api/auth/logout?locale=${locale}`}>{tCommon("logout")}</a>
        </Button>
      </div>

      {/* Dashboard summary — subscriptions card is clickable */}
      <DashboardSummary
        orderCount={orders.length}
        subscriptionCount={subscriptionCount}
        labels={{
          favorites: t("dashboardFavorites"),
          follows: t("dashboardFollows"),
          events: t("dashboardEvents"),
          orders: t("dashboardOrders"),
          subscriptions: t("dashboardSubscriptions"),
        }}
        links={{
          subscriptions: "/account/subscriptions",
        }}
      />

      {/* Membership status */}
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("membershipStatus")}
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("currentTier")}</p>
            <p className="text-sm">{tierLabels[membershipTier]}</p>
          </div>
          {membershipTier !== "premium" && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/membership">{t("viewPlans")}</Link>
            </Button>
          )}
        </div>
      </section>

      {/* Subscriptions summary — link to dedicated page */}
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("subscriptions")}
        </h2>
        {subscriptionCount === 0 ? (
          <div>
            <p className="text-muted-foreground text-sm mb-4">
              {t("noSubscriptions")}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/products">{tCommon("products")}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {subscriptionCount}件のご契約
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/account/subscriptions">{t("viewSubscriptions")}</Link>
            </Button>
          </div>
        )}
      </section>

      {/* Favorite products */}
      <FavoritesSection
        type="product"
        title={t("favoriteProducts")}
        emptyMessage={t("noFavoriteProducts")}
        errorMessage={t("actionError")}
        removedMessage={t("removedFromFavorites")}
        locale={locale}
        productBaseUrl="/products"
        articleBaseUrl="/journal"
      />

      {/* Favorite articles */}
      <FavoritesSection
        type="article"
        title={t("favoriteArticles")}
        emptyMessage={t("noFavoriteArticles")}
        errorMessage={t("actionError")}
        removedMessage={t("removedFromFavorites")}
        locale={locale}
        productBaseUrl="/products"
        articleBaseUrl="/journal"
      />

      {/* Following farmers */}
      <FollowsSection
        title={t("followingFarmers")}
        emptyMessage={t("noFollows")}
        errorMessage={t("actionError")}
        removedMessage={t("unfollowed")}
        locale={locale}
      />

      {/* Registered events */}
      <EventsSection
        title={t("registeredEvents")}
        emptyMessage={t("noEventRegistrations")}
        errorMessage={t("actionError")}
        cancelledMessage={t("eventCancelled")}
        locale={locale}
      />

      {/* Order history summary */}
      <section>
        <h2 className="mb-6 pb-3 border-b border-border">
          {t("orderHistory")}
        </h2>

        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOrders")}</p>
        ) : (
          <div className="space-y-4">
            {orders.slice(0, 3).map(({ node: order }) => (
              <div
                key={order.id}
                className="flex items-center justify-between py-4 border-b border-border"
              >
                <div>
                  <p className="text-sm font-medium">{order.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(order.processedAt, locale)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm">
                    {formatPrice(
                      order.totalPrice.amount,
                      order.totalPrice.currencyCode,
                      locale
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick links */}
      <Separator className="mt-12" />
      <section className="pt-8">
        <div className="flex flex-wrap gap-4">
          <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
            <Link href="/products">{tCommon("products")}</Link>
          </Button>
          <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
            <Link href="/journal">{tCommon("journal")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
