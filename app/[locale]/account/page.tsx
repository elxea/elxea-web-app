import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import {
  AccountCardGrid,
  AccountCta,
  AccountExpCard,
  AccountGreetingBand,
  AccountOpsBand,
  AccountPaymentMethodCard,
  AccountRecordCard,
  AccountSectionHeader,
  AccountTitleBlock,
} from "@/components/account/account-parts";
import { LineAccountView } from "@/components/account/line-account-view";
import { LineLinkageEntry } from "@/components/account/line-linkage-entry";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { customerAccountPortalUrl } from "@/lib/account-links";
import {
  buildAccountView,
  formatRecordDate,
  type AccountRecord,
  type AccountView,
} from "@/lib/account-view";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { getEventRegistrations, getFavorites } from "@/lib/firebase/server-actions";
import { seedAccountView } from "@/lib/preview-seed";
import type { Customer } from "@/lib/shopify/customer";
import { getCustomerFromSession, getSubscriptionsFromSession } from "@/lib/shopify/auth";
import { cn, formatPrice } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("account") };
}

/**
 * マイページ /ja/account —【R2: 確定版】マイページ (トップ)
 * 親 `8095:731` / PC `8095:733` / SP `8095:792`。お支払い方法の節は
 * PC `8144:1248`〜`8144:1257` / SP `8145:1248`〜`8145:1257`。
 *
 * 確定版の節構成 (Figma 実測どおり・順序も同じ):
 *   1. TitleBlock          主見出し + 「…としてログイン中」(+ PC のみ「設定・契約 →」)
 *   2. GreetingBand        面つきの挨拶
 *   3. これから            次回の定期便 + これから開催のイベント申込 (RecordCard)
 *   4. 続き                お気に入り (ExpCard)
 *   5. これまで            注文履歴 (RecordCard)
 *   6. お支払い方法        ご登録のカード (PaymentMethodCard) + 変更は外部リンク 1 本
 *   7. AccountOpsBand      契約・お支払い・お届け先の案内 + CTA
 *
 * 確定版に**無い**もの: 住所の編集 UI / 支払方法の変更 UI / お気に入りの削除 UI。
 * お届け先・お支払い方法・注文明細は Shopify の顧客アカウントポータルへ 1 本の
 * 外部リンクで送る設計 (AccountOpsBand 8095:788 の本文がそう言っている)。
 * ここで独自の CRUD 画面を足さない。
 *
 * 認証は既存のまま (getCustomerFromSession / LINE セッション判定に手を入れない)。
 */
export default async function AccountPage() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  let customer: Customer | null = null;
  try {
    customer = await getCustomerFromSession();
  } catch {
    // fall through — check for LINE session below
  }

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ)。実セッションがあるときは呼ばない
     ので、実データを見本で上書きすることはない。フラグ未設定なら null。 */
  const seeded = customer ? null : seedAccountView();

  if (!customer && !seeded) {
    // P7-fix: Check if user is logged in via LINE (without Shopify session).
    // LINE-only users have line_session + line_user cookies but no shop_at/shop_rt.
    const cookieStore = await cookies();
    const hasLineSession = cookieStore.has("line_session");
    const lineUserCookie = cookieStore.get("line_user")?.value;
    const lineDisplayName = getLineDisplayName(lineUserCookie);

    if (hasLineSession && lineDisplayName) {
      // Show LINE-only account view with Shopify connection prompt
      return <LineAccountView displayName={lineDisplayName} locale={locale} />;
    }

    // Fully unauthenticated — show login prompt
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
        <div className="max-w-sm text-center">
          <h1 className="page-title mb-4 text-foreground">{tCommon("account")}</h1>
          <p className={cn(captionClass, "mb-8 text-muted-foreground")}>
            {t("loginRequired")}
          </p>
          <Button variant="outline" asChild>
            <a href={`/${locale}/login`}>{tCommon("login")}</a>
          </Button>
        </div>
      </div>
    );
  }

  const view: AccountView = customer ? await loadAccountView(customer) : (seeded as AccountView);
  const portalUrl = customerAccountPortalUrl();

  const recordDate = (record: AccountRecord) => formatRecordDate(record.date, locale);

  return (
    <>
      <AccountTitleBlock
        title={tCommon("account")}
        identity={view.email ? t("loggedInAs", { email: view.email }) : undefined}
        action={
          portalUrl ? { label: t("settingsLink"), href: portalUrl, external: true } : undefined
        }
      />

      <AccountGreetingBand
        greeting={
          view.displayName
            ? t("greeting", { name: view.displayName })
            : t("greetingNoName")
        }
        lead={t("greetingLead")}
      />

      {/* 3. これから — 次回の定期便 + これから開催のイベント */}
      {view.upcoming.length > 0 ? (
        <>
          <AccountSectionHeader
            title={t("upcomingHeading")}
            action={{ label: t("upcomingAll"), href: "/account/subscriptions" }}
          />
          <AccountCardGrid columns={3}>
            {view.upcoming.map((record) => {
              const date = recordDate(record);
              const isSubscription = record.kind === "subscription";
              return (
                <AccountRecordCard
                  key={record.id}
                  meta={
                    date
                      ? isSubscription
                        ? t("upcomingDeliveryMeta", { date })
                        : t("upcomingEventMeta", { date })
                      : undefined
                  }
                  title={
                    isSubscription
                      ? t("upcomingDeliveryTitle", { title: record.title })
                      : record.title
                  }
                  note={isSubscription ? t("upcomingDeliveryNote") : t("upcomingEventNote")}
                  href={record.href}
                />
              );
            })}
          </AccountCardGrid>
        </>
      ) : null}

      {/* 4. 続き — お気に入り */}
      {view.continueItems.length > 0 ? (
        <>
          <AccountSectionHeader
            title={t("continueHeading")}
            action={{ label: t("continueAll"), href: "/journal" }}
          />
          <AccountCardGrid columns={2}>
            {view.continueItems.map((item) => (
              <AccountExpCard
                key={item.id}
                label={t("continueFavorite")}
                title={item.title}
                imageUrl={item.imageUrl}
                href={item.href}
              />
            ))}
          </AccountCardGrid>
        </>
      ) : null}

      {/* 5. これまで — 注文履歴 */}
      {view.past.length > 0 ? (
        <>
          <AccountSectionHeader
            title={t("pastHeading")}
            action={
              portalUrl ? { label: t("pastAll"), href: portalUrl, external: true } : undefined
            }
          />
          <AccountCardGrid columns={3}>
            {view.past.map((record) => {
              const date = recordDate(record);
              return (
                <AccountRecordCard
                  key={record.id}
                  meta={date ? t("pastOrderMeta", { date }) : undefined}
                  title={t("pastOrderTitle", { name: record.title })}
                  note={
                    record.amount
                      ? formatPrice(record.amount.value, record.amount.currencyCode)
                      : undefined
                  }
                />
              );
            })}
          </AccountCardGrid>
        </>
      ) : null}

      {/* 6. お支払い方法 — 登録カードの表示のみ。変更は外部リンク 1 本 */}
      {view.paymentMethod || portalUrl ? (
        <>
          <AccountSectionHeader
            title={t("paymentHeading")}
            action={
              portalUrl
                ? { label: t("paymentChange"), href: portalUrl, external: true }
                : undefined
            }
          />
          <AccountCardGrid columns={2}>
            {view.paymentMethod ? (
              <AccountPaymentMethodCard
                label={t("paymentCardLabel")}
                brand={view.paymentMethod.brand}
                masked={t("paymentCardMasked", { last4: view.paymentMethod.last4 })}
                note={t("paymentCardNote")}
              />
            ) : (
              /* 登録カードを読む経路がまだ無い (アプリ権限
                 read_customer_payment_methods 未付与)。分からないものを
                 「未登録」と断定せず、確認先だけを案内する。 */
              <p className={cn(captionClass, "text-muted-foreground")}>
                {t("paymentUnavailable")}
              </p>
            )}
          </AccountCardGrid>
        </>
      ) : null}

      {/* 7. 末尾の案内帯 */}
      <AccountOpsBand note={t("opsNote")}>
        <AccountCta label={t("manageSubscription")} href="/account/subscriptions" />
      </AccountOpsBand>

      {/* LINE 連携エントリ (Web 側導線 / Phase 2)。確定版のフレームには無いが、
          唯一の Web 側入口なので残す。NEXT_PUBLIC_LIFF_ID 未設定なら描かれない。 */}
      <LineLinkageEntry locale={locale} />
    </>
  );
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

/** 実データ (Shopify + Firestore) からマイページの描画モデルを組む。 */
async function loadAccountView(customer: Customer): Promise<AccountView> {
  const [subscriptions, activity] = await Promise.all([
    getSubscriptionsFromSession().catch(() => []),
    loadActivity(),
  ]);

  return buildAccountView({
    customer,
    subscriptions,
    favorites: activity.favorites,
    events: activity.events,
  });
}

/**
 * Firestore 側 (お気に入り / イベント申込) を server component から直接読む。
 * 既存の /api/user/* と同じ関数・同じ userKey を使う (二重定義しない)。
 * 失敗しても節が消えるだけなのでページ全体は落とさない。
 */
async function loadActivity(): Promise<{
  favorites: Awaited<ReturnType<typeof getFavorites>>;
  events: Awaited<ReturnType<typeof getEventRegistrations>>;
}> {
  try {
    const identity = await resolveIdentity();
    if (!identity.authenticated) return { favorites: [], events: [] };

    const [favorites, events] = await Promise.all([
      getFavorites(identity.userKey).catch(() => []),
      getEventRegistrations(identity.userKey).catch(() => []),
    ]);
    return { favorites, events };
  } catch {
    return { favorites: [], events: [] };
  }
}
