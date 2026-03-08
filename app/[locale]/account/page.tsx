import { getTranslations, getLocale } from "next-intl/server";
import { getCustomerFromSession } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Customer info */}
      <div className="mb-12">
        <h1 className="text-2xl mb-2">{tCommon("account")}</h1>
        {displayName && (
          <p className="text-sm text-foreground">{displayName}</p>
        )}
        {email && <p className="text-sm text-muted-foreground">{email}</p>}

        <Button variant="link" className="mt-6 p-0 h-auto text-muted-foreground" asChild>
          <a href={`/api/auth/logout?locale=${locale}`}>{tCommon("logout")}</a>
        </Button>
      </div>

      {/* Order history */}
      <section>
        <h2 className="text-lg mb-6 pb-3 border-b border-border">
          {t("orderHistory")}
        </h2>

        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOrders")}</p>
        ) : (
          <div className="space-y-4">
            {orders.map(({ node: order }) => (
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
