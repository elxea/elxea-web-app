import { getTranslations, getLocale } from "next-intl/server";
import { getCustomerFromSession } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";

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
        <h1 className="text-2xl mb-6">{tCommon("account")}</h1>
        <p className="text-muted mb-8">{t("loginRequired")}</p>
        <a
          href={`/api/auth/login?locale=${locale}`}
          className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
        >
          {tCommon("login")}
        </a>
      </div>
    );
  }

  const displayName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  const email = customer.emailAddress?.emailAddress;
  const orders = customer.orders?.edges ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Customer info */}
      <div className="mb-12">
        <h1 className="text-2xl mb-2">{tCommon("account")}</h1>
        {displayName && (
          <p className="text-[15px] text-charcoal">{displayName}</p>
        )}
        {email && <p className="text-[13px] text-muted">{email}</p>}

        <a
          href={`/api/auth/logout?locale=${locale}`}
          className="inline-block mt-6 text-[13px] text-muted underline hover:text-charcoal transition-colors"
        >
          {tCommon("logout")}
        </a>
      </div>

      {/* Order history */}
      <section>
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("orderHistory")}
        </h2>

        {orders.length === 0 ? (
          <p className="text-muted text-[14px]">{t("noOrders")}</p>
        ) : (
          <div className="space-y-4">
            {orders.map(({ node: order }) => (
              <div
                key={order.id}
                className="flex items-center justify-between py-4 border-b border-border"
              >
                <div>
                  <p className="text-[14px] font-medium">{order.name}</p>
                  <p className="text-[12px] text-light">
                    {formatDate(order.processedAt, locale)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[14px]">
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
      <section className="mt-12 pt-8 border-t border-border">
        <div className="flex flex-wrap gap-6">
          <Link
            href="/products"
            className="text-[13px] text-muted hover:text-charcoal underline transition-colors"
          >
            {tCommon("products")}
          </Link>
          <Link
            href="/journal"
            className="text-[13px] text-muted hover:text-charcoal underline transition-colors"
          >
            {tCommon("journal")}
          </Link>
        </div>
      </section>
    </div>
  );
}
