import { cookies } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { getCustomerFromSession, getSubscriptionsFromSession } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ImagePlaceholder } from "@/components/media/image-placeholder";
import { Separator } from "@/components/ui/separator";
import { DashboardSummary } from "@/components/account/dashboard-summary";
import { FavoritesSection } from "@/components/account/favorites-section";
import { FollowsSection } from "@/components/account/follows-section";
import { EventsSection } from "@/components/account/events-section";
import { LineAccountView } from "@/components/account/line-account-view";
import { LineLinkageEntry } from "@/components/account/line-linkage-entry";

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

/**
 * Parse LINE user cookie to get display name.
 * The cookie stores JSON: { displayName: string }
 */
function getLineDisplayName(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  try {
    const parsed = JSON.parse(cookieValue);
    return parsed.displayName ?? null;
  } catch {
    return null;
  }
}

export default async function AccountPage() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  let customer = null;
  try {
    customer = await getCustomerFromSession();
  } catch {
    // fall through — check for LINE session below
  }

  if (!customer) {
    // P7-fix: Check if user is logged in via LINE (without Shopify session).
    // LINE-only users have line_session + line_user cookies but no shop_at/shop_rt.
    const cookieStore = await cookies();
    const hasLineSession = cookieStore.has("line_session");
    const lineUserCookie = cookieStore.get("line_user")?.value;
    const lineDisplayName = getLineDisplayName(lineUserCookie);

    if (hasLineSession && lineDisplayName) {
      // Show LINE-only account view with Shopify connection prompt
      return (
        <LineAccountView
          displayName={lineDisplayName}
          locale={locale}
        />
      );
    }

    // Fully unauthenticated — show login prompt
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-24">
        <div className="text-center max-w-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Account
          </p>
          <h1 className="text-2xl font-normal mb-4">{tCommon("account")}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">{t("loginRequired")}</p>
          <Button variant="outline" asChild>
            <a href={`/${locale}/login`}>{tCommon("login")}</a>
          </Button>
        </div>
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

  /* 会員ランク (フリー / スタンダード / プレミアム) の表示は廃止した。
   * elxea は会員制度を持たず、会員かどうかは「roji 契約の有無」の二値である
   * (Setaka 確定 2026-08-17)。契約の有無は下の定期便セクション
   * (`subscriptionCount`) がそのまま表しているので、ランク表示は不要。 */

    return (
      <div className="section-narrow py-20">
        <div className="mb-12 flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
              Account
            </p>
            <h1 className="mb-4">{tCommon("account")}</h1>
            {displayName && (
              <p className="text-sm text-muted-foreground">{displayName}</p>
            )}
            {email && <p className="text-sm text-muted-foreground">{email}</p>}
          </div>

          <Button variant="outline" size="sm" className="shrink-0" asChild>
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

      {/* LINE 連携エントリ（Web 側導線 / Phase 2）— NEXT_PUBLIC_LIFF_ID 未設定なら非表示 */}
      <LineLinkageEntry locale={locale} />

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
