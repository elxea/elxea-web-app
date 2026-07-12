import { getTranslations, getLocale } from "next-intl/server";
import Image from "next/image";
import { getCustomerFromSession, getSubscriptionsFromSession } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { SubscriptionContract } from "@/lib/shopify/customer";
import { SubscriptionActions, type SubscriptionActionLabels } from "@/components/account/subscription-actions";

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

export default async function SubscriptionsPage() {
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
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-24">
        <div className="text-center max-w-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Subscription
          </p>
          <h1 className="text-2xl font-normal mb-4">{t("subscriptions")}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">{t("loginRequired")}</p>
          <Button variant="outline" asChild>
            <a href={`/api/auth/login?locale=${locale}`}>{tCommon("login")}</a>
          </Button>
        </div>
      </div>
    );
  }

  let subscriptions: SubscriptionContract[] = [];
  try {
    subscriptions = await getSubscriptionsFromSession();
  } catch {
    // Subscription API may not be available
  }

  return (
    <div className="section-narrow py-20">
      {/* Back link */}
      <div className="mb-8">
        <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
          <Link href="/account">{t("backToAccount")}</Link>
        </Button>
      </div>

      {/* Editorial header */}
      <div className="mb-12">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Subscription
        </p>
        <h1 className="mb-4">{t("subscriptions")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("subscriptionNoteManage")}
        </p>
      </div>

      {/* Subscription list */}
      {subscriptions.length === 0 ? (
        <div>
          <p className="text-muted-foreground text-sm mb-4">
            {t("noSubscriptions")}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/products">{tCommon("products")}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <h2 className="text-lg pb-3 border-b border-border">
            {t("currentSubscriptions")}
          </h2>
          {subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              subscription={sub}
              locale={locale}
              t={t}
            />
          ))}
          <p className="text-xs text-muted-foreground">
            {t("subscriptionNote")}
          </p>
        </div>
      )}
    </div>
  );
}

function SubscriptionCard({
  subscription,
  locale,
  t,
}: {
  subscription: SubscriptionContract;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const statusMap: Record<string, string> = {
    ACTIVE: t("subscriptionActive"),
    PAUSED: t("subscriptionPaused"),
    CANCELLED: t("subscriptionCancelled"),
  };

  const statusColorMap: Record<string, string> = {
    ACTIVE: "text-green-700 bg-green-50",
    PAUSED: "text-yellow-700 bg-yellow-50",
    CANCELLED: "text-muted-foreground bg-muted",
  };

  const statusLabel = statusMap[subscription.status] ?? subscription.status;
  const statusColor = statusColorMap[subscription.status] ?? "text-muted-foreground bg-muted";

  const { interval, intervalCount: intervalCountObj } = subscription.deliveryPolicy;
  const intervalCount = intervalCountObj.count;
  const intervalKey =
    interval === "MONTH"
      ? "intervalMonth"
      : interval === "WEEK"
        ? "intervalWeek"
        : "intervalDay";

  const lines = subscription.lines?.edges ?? [];

  return (
    <div className="border border-border p-5">
      {/* Status + next delivery */}
      <div className="flex items-center justify-between mb-4">
        <span className={`text-xs px-2 py-1 ${statusColor}`}>
          {statusLabel}
        </span>
        {subscription.nextBillingDate && (
          <p className="text-xs text-muted-foreground">
            {t("nextDelivery")}: {formatDate(subscription.nextBillingDate, locale)}
          </p>
        )}
      </div>

      {/* Line items */}
      <div className="space-y-3">
        {lines.map(({ node: line }) => (
          <div key={line.id} className="flex items-center gap-4">
            {line.variantImage ? (
              <Image
                src={line.variantImage.url}
                alt={line.variantImage.altText ?? line.title}
                width={56}
                height={56}
                className="object-cover"
              />
            ) : (
              <div className="w-14 h-14 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                —
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{line.title}</p>
              {line.variantTitle && (
                <p className="text-xs text-muted-foreground">{line.variantTitle}</p>
              )}
              <p className="text-xs text-muted-foreground">
                × {line.quantity}
              </p>
            </div>
            <p className="text-sm">
              {formatPrice(line.currentPrice.amount, line.currentPrice.currencyCode, locale)}
            </p>
          </div>
        ))}
      </div>

      {/* Delivery interval + actions */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">
            {t("deliveryInterval")}: {t(intervalKey, { count: intervalCount })}
          </p>
        </div>
        {(subscription.status === "ACTIVE" || subscription.status === "PAUSED") && (
          <SubscriptionActions
            contractId={subscription.id}
            status={subscription.status}
            currentInterval={interval}
            currentIntervalCount={intervalCount}
            labels={{
              skipNext: t("skipNext"),
              changeFrequency: t("changeFrequency"),
              pauseSubscription: t("pauseSubscription"),
              cancelSubscription: t("cancelSubscription"),
              confirmCancel: t("confirmCancel"),
              resumeSubscription: t("resumeSubscription"),
              selectFrequency: t("selectFrequency"),
              cancel: t("cancel"),
              actionError: t("actionError"),
              frequencyChanged: t("frequencyChanged"),
              frequencyChangeError: t("frequencyChangeError"),
              frequencyOptions: {
                everyWeek: t("frequencyEveryWeek"),
                every2Weeks: t("frequencyEvery2Weeks"),
                everyMonth: t("frequencyEveryMonth"),
                every2Months: t("frequencyEvery2Months"),
                every3Months: t("frequencyEvery3Months"),
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
