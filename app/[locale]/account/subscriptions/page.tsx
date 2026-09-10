import type { Metadata } from "next";
import { cookies } from "next/headers";
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
import {
  accountActionHref,
  isSignedIn,
  lockedActionFor,
  type AccountAuth,
} from "@/lib/account-capabilities";
import { hasLineSessionCookies } from "@/lib/auth/cookies";
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

  /* 3 値で受ける (設計憲章 R1)。`ok: false` は「未ログイン」ではなく「判定できな
     かった」。以前は try/catch で両方 null に潰していたので、Shopify の一時障害が
     そのまま「ログインが必要です」→ /login への堂々巡りになっていた。 */
  const customerResult = await getCustomerFromSession();
  const customer = customerResult.ok ? customerResult.data : null;
  const shopifyUndetermined = !customerResult.ok;

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ)。実セッションがあるときは呼ばない
     ので、実データを見本で上書きすることはない。フラグ未設定なら null。 */
  const seeded = customer ? null : seedSubscriptionContracts();

  /* 判定できなかった人を「未ログイン」の分岐に落とさない。その人は cookie を
     持っていて middleware を通っている以上、ログインし直しても同じ画面に戻る。 */
  if (!customer && !seeded && shopifyUndetermined) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
        <div className="max-w-sm text-center">
          <h1 className="page-title mb-4 text-foreground">{t("subscriptions")}</h1>
          <p className={cn(captionClass, "mb-8 text-muted-foreground")}>
            {t("networkError")}
          </p>
          <div className="flex justify-center gap-4">
            <Button variant="outline" asChild>
              <a href={`/${locale}/account/subscriptions`}>{tCommon("retry")}</a>
            </Button>
            <Button variant="link" className="h-auto p-0 text-muted-foreground" asChild>
              <Link href="/account">{t("backToAccountLink")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!customer && !seeded) {
    /* LINE だけでログインしている人もここに来る。`middleware.ts` の /account
     * ガードは `line_session` があれば通すので、この画面に到達すること自体は正しい。
     * ところが定期便は Shopify の顧客トークンが無いと引けず、LINE ログインでは
     * そのトークンが発行されない (外部 IdP から Shopify セッションを作る正規手段は
     * Multipass だけで、Plus + legacy 会員に限られる)。
     *
     * つまりこの人は「ログインしていない」のではなく「メールアドレスが連携されて
     * いない」。ログイン済みの人に「ログインが必要です」と出して /login へ送り返すと、
     * LINE で入り直しても同じ画面に戻る堂々巡りになる。案内を出し分ける。
     *
     * どの認証状態で何が使えるかの正本は `lib/account-capabilities.ts`。 */
    const cookieStore = await cookies();
    const auth: AccountAuth = {
      shopify: false,
      line: hasLineSessionCookies((name) => cookieStore.has(name)),
    };

    /* ラベルも行き先もカタログから引く。この画面だけ別の文言・別の行き先を
       持たせない (以前は `/api/auth/login` を直書きしていた — as-is D-18)。 */
    const action = lockedActionFor("subscriptions");

    if (isSignedIn(auth)) {
      return (
        <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
          <div className="max-w-sm text-center">
            <h1 className="page-title mb-4 text-foreground">{t("subscriptions")}</h1>
            <p className={cn(captionClass, "mb-3 text-foreground")}>
              {t("subscriptionsEmailRequired")}
            </p>
            <p className={cn(captionClass, "mb-8 text-muted-foreground")}>
              {t("emailRequiredReason")}
            </p>
            {action ? (
              <Button variant="outline" asChild>
                <a href={accountActionHref(action.target, locale)}>{t(action.labelKey)}</a>
              </Button>
            ) : null}
            <div className="mt-6">
              <Button variant="link" className="h-auto p-0 text-muted-foreground" asChild>
                <Link href="/account">{t("backToAccountLink")}</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }

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
    const contractsResult = await getSubscriptionsFromSession();
    if (!contractsResult.ok) {
      /* **ここが 0 件表示に潰れてはいけない最重要地点** (設計憲章 R1)。
       *
       * 以前は catch で `contracts = []` に倒していた。この画面の 0 件は
       * 「まだ定期便のご契約はありません」という EmptyCard に差し替わるので、
       * Shopify が詰まった瞬間、**契約中の顧客に「契約はありません」と表示**して
       * いたことになる。解約されたと誤解させる表示であり、実際には契約も課金も
       * 生きている。空配列は「0 件だった」という主張であって、「引けなかった」を
       * 表す値ではない。 */
      return (
        <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
          <div className="max-w-sm text-center">
            <h1 className="page-title mb-4 text-foreground">{t("subscriptions")}</h1>
            <p className={cn(captionClass, "mb-8 text-muted-foreground")}>
              {t("networkError")}
            </p>
            <div className="flex justify-center gap-4">
              <Button variant="outline" asChild>
                <a href={`/${locale}/account/subscriptions`}>{tCommon("retry")}</a>
              </Button>
              <Button variant="link" className="h-auto p-0 text-muted-foreground" asChild>
                <Link href="/account">{t("backToAccountLink")}</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }
    contracts = contractsResult.data;
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
    staleViewError: t("staleViewError"),
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
          nextBillingDate={card.nextBillingDate}
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
