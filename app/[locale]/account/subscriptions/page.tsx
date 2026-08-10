import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import {
  SubscriptionActions,
  type SubscriptionActionLabels,
} from "@/components/account/subscription-actions";
import {
  SubscriptionCardFrame,
  SubscriptionCardNote,
  SubscriptionCardTopRow,
  SubscriptionEmptyCard,
  SubscriptionLineRow,
  SubscriptionLines,
  SubscriptionList,
  SubscriptionPageHead,
  SubscriptionSection,
  SubscriptionStatusBadge,
} from "@/components/account/subscription-parts";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { seedSubscriptionContracts } from "@/lib/preview-seed";
import { getCustomerFromSession, getSubscriptionsFromSession } from "@/lib/shopify/auth";
import type { SubscriptionContract } from "@/lib/shopify/customer";
import { getAvailableFrequencyOptions } from "@/lib/subscription-frequencies.server";
import {
  canManageSubscription,
  frequencyOptionKey,
  intervalLabelKey,
  sortSubscriptionCards,
  subscriptionNoteKey,
  subscriptionStatusLabelKey,
  toSubscriptionCardView,
  type FrequencyOption,
  type SubscriptionCardView,
} from "@/lib/subscription-view";
import { cn, formatPrice } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("subscriptions") };
}

/**
 * 定期便管理 /ja/account/subscriptions —【R2: 確定版】(Figma section 6717:14526)
 * PC 1440 `6717:14527` / SP 390 `6723:14747`。
 *
 * 確定版の構成 (Figma 実測どおり・順序も同じ):
 *   1. 戻る導線 (← マイページに戻る)                 6717:14565 / 6723:14752
 *   2. ページ見出し (SUBSCRIPTION / 定期便 / リード)  6717:14566 / 6723:14753
 *   3. ご契約中の定期便 — カードを縦に積む            6717:14570 / 6723:14757
 *        契約中 → 一時停止中 → 解約済み の順
 *   4. 0 件のときは EmptyCard 1 枚に差し替える        6720:9378 / 6723:14874
 *
 * Figma の「定期便の操作」節 (6719:14702) と「空の状態（0件）」節 (6720:9376) は
 * **状態の見た目を並べた注記フレーム**なので、ページには常設しない。前者は
 * カード内に開くパネル、後者は 0 件時の差し替えとして実装する。
 *
 * 操作 (停止 / 再開 / 解約 / 1 回スキップ / 頻度変更) の Server Action は C5-0 で
 * 確定した `lib/shopify/subscription-actions.ts` をそのまま呼ぶ。所有者照合
 * (fail-closed) と billingCycle の実データ解決はサーバ側にあるので、ここでは
 * 触らない。
 */
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

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ)。実セッションがあるときは呼ばない
     ので、実データを見本で上書きすることはない。フラグ未設定なら null。 */
  const seeded = customer ? null : seedSubscriptionContracts();

  if (!customer && !seeded) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
        <div className="max-w-sm text-center">
          <h1 className="page-title mb-4 text-foreground">{t("subscriptions")}</h1>
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

  let contracts: SubscriptionContract[] = seeded ?? [];
  if (customer) {
    try {
      contracts = await getSubscriptionsFromSession();
    } catch {
      // Subscription API may not be available — 空扱いにして節ごと差し替える
      contracts = [];
    }
  }

  const cards = sortSubscriptionCards(contracts.map(toSubscriptionCardView));

  // 選べる頻度は Shopify に実在する selling plan から読む。画面側で並べる頻度を
  // 決め打ちすると、存在しないプランを提示して顧客の変更操作が必ず失敗する。
  const frequencyOptions = await getAvailableFrequencyOptions();

  const labels: SubscriptionActionLabels = {
    skipNext: t("skipNext"),
    changeFrequency: t("changeFrequency"),
    pauseSubscription: t("pauseSubscription"),
    cancelSubscription: t("cancelSubscription"),
    cancelPanelTitle: t("cancelPanelTitle"),
    cancelConfirmBody: t("cancelConfirmBody"),
    confirmCancel: t("confirmCancel"),
    resumeSubscription: t("resumeSubscription"),
    selectFrequency: t("selectFrequency"),
    cancel: t("cancel"),
    actionError: t("actionError"),
    frequencyChanged: t("frequencyChanged"),
    frequencyChangeError: t("frequencyChangeError"),
    previewNotice: t("previewNotice"),
    frequencyOptionLabels: Object.fromEntries(
      frequencyOptions.map((option) => [
        frequencyOptionKey(option),
        t(option.labelKey, option.labelValues),
      ])
    ),
  };

  return (
    <>
      <SubscriptionPageHead
        backHref="/account"
        backLabel={t("backToAccountLink")}
        overline="SUBSCRIPTION"
        title={t("subscriptions")}
        lead={t("subscriptionNoteManage")}
      />

      <SubscriptionSection title={t("currentSubscriptions")} className="pb-16 lg:pb-24">
        {cards.length === 0 ? (
          <SubscriptionEmptyCard message={t("noSubscriptions")}>
            <Button asChild>
              <Link href="/products">{tCommon("products")}</Link>
            </Button>
          </SubscriptionEmptyCard>
        ) : (
          <SubscriptionList>
            {cards.map((card) => (
              <SubscriptionContractCard
                key={card.id}
                card={card}
                locale={locale}
                t={t}
                labels={labels}
                frequencyOptions={frequencyOptions}
                preview={Boolean(seeded)}
              />
            ))}
          </SubscriptionList>
        )}
      </SubscriptionSection>
    </>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** カード 1 枚 (Figma 6718:14888 / 6718:14906 / SP 6723:14796 / 6723:14813)。 */
function SubscriptionContractCard({
  card,
  locale,
  t,
  labels,
  frequencyOptions,
  preview,
}: {
  card: SubscriptionCardView;
  locale: string;
  t: Translate;
  labels: SubscriptionActionLabels;
  frequencyOptions: FrequencyOption[];
  preview: boolean;
}) {
  const statusLabel = t(subscriptionStatusLabelKey(card.kind));

  /* 次回お届け日。停止中は「停止中」、終わっているものは「—」を出す
     (Figma 6718:14892 / 6718:14910)。SP は接頭ラベルを畳んで値だけにする
     (SP 6723:14800 / 6723:14817 が値だけになっている)。 */
  const nextDeliveryValue =
    card.kind === "active"
      ? card.nextBillingDate
        ? formatDeliveryDate(card.nextBillingDate, locale)
        : t("nextDeliveryNone")
      : card.kind === "paused"
        ? t("nextDeliveryPaused")
        : t("nextDeliveryNone");

  const showLabelOnMobile = card.kind === "active";

  const intervalLabel = t(intervalLabelKey(card.interval), { count: card.intervalCount });

  return (
    <SubscriptionCardFrame>
      <SubscriptionCardTopRow
        badge={
          <SubscriptionStatusBadge kind={card.kind}>{statusLabel}</SubscriptionStatusBadge>
        }
        nextDelivery={
          <>
            <span className={showLabelOnMobile ? undefined : "hidden lg:inline"}>
              {t("nextDeliveryLabel")}
            </span>
            {nextDeliveryValue}
          </>
        }
      />

      {card.lines.length > 0 ? (
        <SubscriptionLines>
          {card.lines.map((line) => (
            <SubscriptionLineRow
              key={line.id}
              title={line.title}
              meta={
                line.variantTitle
                  ? t("lineVariantQty", {
                      variant: line.variantTitle,
                      quantity: line.quantity,
                    })
                  : t("lineQty", { quantity: line.quantity })
              }
              price={formatPrice(line.price.amount, line.price.currencyCode)}
              imageUrl={line.imageUrl}
              imageAlt={line.imageAlt ?? line.title}
            />
          ))}
        </SubscriptionLines>
      ) : null}

      <SubscriptionCardNote>
        {t("intervalLine", { value: intervalLabel })}
      </SubscriptionCardNote>

      {canManageSubscription(card.kind) ? (
        <SubscriptionActions
          contractId={card.id}
          kind={card.kind === "active" ? "active" : "paused"}
          currentInterval={card.interval}
          currentIntervalCount={card.intervalCount}
          frequencyOptions={frequencyOptions}
          labels={labels}
          preview={preview}
        />
      ) : null}

      <SubscriptionCardNote>{t(subscriptionNoteKey(card.kind))}</SubscriptionCardNote>
    </SubscriptionCardFrame>
  );
}

/** 「2026年6月15日」形式 (Figma 6717:14568 付近の見本と同じ体裁)。 */
function formatDeliveryDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
