import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import {
  AccountCardGrid,
  AccountCta,
  AccountExpCard,
  AccountGreetingBand,
  AccountLockedCard,
  AccountOpsBand,
  AccountPaymentMethodCard,
  AccountRecordCard,
  AccountSectionHeader,
  AccountTitleBlock,
} from "@/components/account/account-parts";
import { FollowsSection } from "@/components/account/follows-section";
import { LineLinkageEntry } from "@/components/account/line-linkage-entry";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { customerAccountPortalUrl } from "@/lib/account-links";
import {
  fetchLineLinkageStatus,
  fetchLineLinkageStatusForLineUser,
  UNKNOWN_LINE_LINKAGE,
  type LineLinkageStatus,
} from "@/lib/line/linkage-status";
import { readVerifiedLineUserId } from "@/lib/line/session";
import { LINK_RESULT_PARAM } from "@/lib/line/link-flow";
import { FAVORITE_KIND_META } from "@/lib/account-favorites";
import {
  ACCOUNT_SECTION_ORDER,
  accountActionHref,
  isAvailable,
  isSignedIn,
  splitSectionItems,
  type AccountAuth,
  type AccountItem,
  type AccountSectionId,
} from "@/lib/account-capabilities";
import {
  buildAccountView,
  buildContinueItems,
  buildUpcoming,
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
 *   5. フォロー中の農家
 *   6. これまで            注文履歴 (RecordCard)
 *   7. お支払い方法        ご登録のカード (PaymentMethodCard) + 変更は外部リンク 1 本
 *   8. AccountOpsBand      契約・お支払い・お届け先の案内 + CTA
 *
 * ## ログイン経路で画面を切り替えない
 *
 * 以前はここで LINE セッションを見て `LineAccountView` を return し、**マイページ
 * 全体を別のコンポーネントに差し替えて**いた。同じ画面を 2 箇所に書いていたので
 * 片方に足した項目がもう片方から抜ける (「フォロー中の農家」が LINE 側にしか
 * 無かった)。今は経路にかかわらずこの 1 ファイルが全項目を並べる。
 *
 * どの項目がどの認証状態で使えるかは `lib/account-capabilities.ts` が唯一の正本で、
 * ここは並べるだけ。使えない項目は消さず、同じ位置に `AccountLockedCard` を置いて
 * 理由と次の行動をその場に出す。
 *
 * 満たすべき関係: **メールで入った人は、LINE で入った人が見られるものを必ず全部
 * 見られる** (上位集合)。逆は成り立たない — 注文履歴・定期便・お支払い方法は
 * Shopify の顧客トークンが要り、LINE ログインではそれが構造上得られないため。
 *
 * 確定版に**無い**もの: 住所の編集 UI / 支払方法の変更 UI / お気に入りの削除 UI。
 * お届け先・お支払い方法・注文明細は Shopify の顧客アカウントポータルへ 1 本の
 * 外部リンクで送る設計 (AccountOpsBand 8095:788 の本文がそう言っている)。
 */
export default async function AccountPage({
  searchParams,
}: {
  /* Next 15+ では searchParams は Promise。連携フローからの復帰結果
     (`?line_link=success|error|conflict|line-conflict`) を受け取るためだけに使う。 */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  let customer: Customer | null = null;
  try {
    customer = await getCustomerFromSession();
  } catch {
    // fall through — LINE セッションの有無を下で見る
  }

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ)。実セッションがあるときは呼ばない
     ので、実データを見本で上書きすることはない。フラグ未設定なら null。 */
  const seeded = customer ? null : seedAccountView();

  const cookieStore = await cookies();

  /* LINE ログインの判定は `line_session` **だけ** で行う。
   *
   * これは httpOnly なので JS からは読めず消せず、`middleware.ts` の /account
   * ガードが見ているのと同じ cookie でもある。以前はここで `line_user` (表示名を
   * 入れた非 httpOnly cookie) も AND 条件にしていたため、`line_user` だけが失われた
   * 状態 — 拡張機能の cookie 掃除・手動削除など — で middleware は通すのに画面だけ
   * 「ログインが必要です」に落ちていた。
   *
   * 判定を緩めたわけではない。認証の強さを決めるのは httpOnly の `line_session` の
   * ままで、そこに「表示名が取れたか」という無関係な条件を混ぜるのをやめただけ。
   * 表示名は取れたときだけ出し、取れなければ名前の行を省く。 */
  const auth: AccountAuth = {
    shopify: Boolean(customer || seeded),
    line: cookieStore.has("line_session"),
  };

  if (!isSignedIn(auth)) {
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

  /* LINE 連携状態 (P1)。識別子は **サーバセッション由来の値だけ** を使う
     (URL パラメータ等からは受けない — 他人の連携状態を覗ける穴になる)。
       - メールでログイン中 … customer.id で順引き
       - LINE でログイン中   … 暗号化 cookie の復号結果 (サーバ確定の LINE userId) で逆引き
     PREVIEW_SEED の見本表示では実セッションが無いので問い合わせず「不明」のままにする。
     読み取りは never throw で、失敗しても linked=null になるだけ (マイページは落ちない)。

     ## 描画モデルの組み立てと**並列**に始める (直列チェーンの解消 / F15)

     ここは以前、`loadAccountView()` を待ち切ってから連携照会を投げていた。両者に
     依存関係は無い (連携状態はお気に入りにも定期便にも影響しない) のに直列だったので、
     マイページの表示までの時間が「Shopify の往復 + Firestore の読み + cx-agent の往復」
     の**足し算**になっていた。cx-agent が遅い日はその 3000ms がまるごと上乗せされる。
     いま両方を先に走らせて最後に待つので、待ち時間は足し算ではなく**いちばん長い 1 本**
     になる。

     逆引きは `resolveIdentity()` (描画モデル側) も同じ往復を使うため、並列化すると
     キャッシュが冷えている初回に 2 本同時に出うる。`lib/line/linkage-status.ts` の
     走行中重複の畳み込みがそれを 1 本にまとめている (1 描画あたり cx-agent 往復 1 回)。 */
  const lineUserId = customer ? null : auth.line ? await readVerifiedLineUserId() : null;

  const linkagePromise: Promise<LineLinkageStatus> = customer
    ? fetchLineLinkageStatus(customer.id)
    : lineUserId
      ? fetchLineLinkageStatusForLineUser(lineUserId)
      : Promise.resolve(UNKNOWN_LINE_LINKAGE);

  const viewPromise: Promise<AccountView> = customer
    ? loadAccountView(customer)
    : seeded
      ? Promise.resolve(seeded)
      : loadLineOnlyAccountView(getLineDisplayName(cookieStore.get("line_user")?.value));

  const [view, lineLinkage] = await Promise.all([viewPromise, linkagePromise]);

  /* 連携フロー (P2) から戻ってきた直後の結果。値は 2 つだけを許し、それ以外は無視する
     (任意の文字列を画面の分岐に持ち込ませない)。表示は LineLinkageEntry の中に閉じ、
     専用の完了画面は作らない。 */
  const rawLineLink = (await searchParams)?.[LINK_RESULT_PARAM];
  const lineLinkResult =
    rawLineLink === "success" ||
    rawLineLink === "error" ||
    rawLineLink === "conflict" ||
    rawLineLink === "line-conflict"
      ? rawLineLink
      : undefined;

  /* Shopify 顧客アカウントポータルへの外部リンク。LINE だけの人はポータルの
     セッションを持たないので出さない (押しても入れない導線を置かない)。 */
  const portalUrl = auth.shopify ? customerAccountPortalUrl() : null;

  /* 会員ランク (フリー / スタンダード / プレミアム) の表示は持たない。
   * elxea は会員制度を持たず、会員かどうかは「roji 契約の有無」の二値である
   * (Setaka 確定 2026-08-17 / main #62)。 */

  const recordDate = (record: AccountRecord) => formatRecordDate(record.date, locale);

  /** 使えない項目 1 件をグレーのカードにする。文言も行き先もカタログ経由。
   *
   * 行き先をここで組み立てない — 以前は `lockedActionKey` が何であっても
   * `/api/auth/login` に直書きで送っていた (as-is D-18)。ラベルと行き先は
   * カタログで対になっており、URL への変換は `accountActionHref` の 1 箇所だけ。 */
  const lockedCard = (item: AccountItem) => (
    <AccountLockedCard
      key={item.id}
      title={t(item.lockedTitleKey)}
      reason={t(item.lockedReasonKey)}
      action={
        item.lockedAction
          ? {
              label: t(item.lockedAction.labelKey),
              href: accountActionHref(item.lockedAction.target, locale),
            }
          : undefined
      }
    />
  );

  /**
   * 節ごとの描画。キーは `AccountSectionId` なので、カタログに節を足すと
   * ここが型エラーになる — 片方の画面にだけ項目を足す事故を型で止める。
   */
  const sections: Record<AccountSectionId, ReactNode> = {
    /* 3. これから — 次回の定期便 + これから開催のイベント */
    upcoming: (() => {
      const { locked } = splitSectionItems("upcoming", auth);
      if (view.upcoming.length === 0 && locked.length === 0) return null;
      return (
        <>
          <AccountSectionHeader
            title={t("upcomingHeading")}
            action={
              isAvailable("subscriptions", auth)
                ? { label: t("upcomingAll"), href: "/account/subscriptions" }
                : undefined
            }
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
            {locked.map(lockedCard)}
          </AccountCardGrid>
        </>
      );
    })(),

    /* 4. 続き — お気に入りの抜粋。
       ここは **抜粋** (`ACCOUNT_CONTINUE_LIMIT` = 6 枚) で、全件・種類別・解除は
       /account/favorites が引き受ける。以前は 2 枚しか出ないうえ「すべて見る」が
       ジャーナル一覧 (= 自分のお気に入りではない) へ飛んでいたので、残りに辿り
       着けなかった (Setaka 指摘 2026-08-25)。
       カードのラベルは種類ごとに変える — 全部「お気に入り」だと、並んだカードの
       どれが商品でどれが読みものか押すまで分からない。 */
    continue: (() => {
      const { locked } = splitSectionItems("continue", auth);
      if (view.continueItems.length === 0 && locked.length === 0) return null;
      return (
        <>
          <AccountSectionHeader
            title={t("continueHeading")}
            action={{ label: t("continueAll"), href: "/account/favorites" }}
          />
          <AccountCardGrid columns={2}>
            {view.continueItems.map((item) => (
              <AccountExpCard
                key={item.id}
                label={t(FAVORITE_KIND_META[item.kind].labelKey)}
                title={item.title}
                imageUrl={item.imageUrl}
                imageAlt={item.title}
                href={item.href}
              />
            ))}
            {locked.map(lockedCard)}
          </AccountCardGrid>
        </>
      );
    })(),

    /* 5. フォロー中の農家 — 経路によらず出す。
       Firestore 側の情報なので LINE だけの人にも引ける (`resolveIdentity()` が
       LINE の識別子を解決する)。以前はこの節が LINE 側の画面にしか無かった。
       造作は旧世代の `account-panel` のままで、R2 確定版が起きたら寄せる。 */
    follows: (
      <div className="page-container">
        <FollowsSection
          title={t("followingFarmers")}
          emptyMessage={t("noFollows")}
          errorMessage={t("actionError")}
          removedMessage={t("unfollowed")}
          locale={locale}
        />
      </div>
    ),

    /* 6. これまで — 注文履歴 */
    past: (() => {
      const { locked } = splitSectionItems("past", auth);
      if (view.past.length === 0 && locked.length === 0) return null;
      return (
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
            {locked.map(lockedCard)}
          </AccountCardGrid>
        </>
      );
    })(),

    /* 7. お支払い方法 — 登録カードの表示のみ。変更は外部リンク 1 本 */
    payment: (() => {
      const { locked } = splitSectionItems("payment", auth);
      if (locked.length === 0 && !view.paymentMethod && !portalUrl) return null;
      return (
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
            {locked.length > 0 ? (
              locked.map(lockedCard)
            ) : view.paymentMethod ? (
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
      );
    })(),
  };

  return (
    <>
      <AccountTitleBlock
        title={tCommon("account")}
        identity={
          view.email
            ? t("loggedInAs", { email: view.email })
            : auth.line
              ? t("lineConnected")
              : undefined
        }
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

      {ACCOUNT_SECTION_ORDER.map((section) => (
        <div key={section}>{sections[section]}</div>
      ))}

      {/* 8. 末尾の案内帯。定期便を触れない人に「管理する」ボタンは出さない
          (押した先で「連携が必要です」に当たるだけなので)。 */}
      <AccountOpsBand note={t("opsNote")}>
        {isAvailable("subscriptions", auth) ? (
          <AccountCta label={t("manageSubscription")} href="/account/subscriptions" />
        ) : null}
      </AccountOpsBand>

      {/* LINE 連携エントリ (Web 側導線 / Phase 2 + 連携状態表示 / P1 + LINE ログイン中の
          解除導線 / A 案)。**ログイン経路で節ごと消さない** — 以前はここが `auth.shopify`
          だったため、LINE で入っている人は連携済みでも解除に到達できなかった。

          ワンタップ (J-1 案A) を入れたことで、この節は **どの状態でも必ず出る**。
          以前は「LINE セッションで未連携」のときだけ節ごと畳んでいた (`hidden`) が、
          その結果 LINE だけで使っている人のマイページに連携の入口が 1 つも無かった。
          何をどう出すかの判断は 1 か所 (`resolveLineLinkageEntryMode`) が持ち、
          ここは枠を置くだけにする。 */}
      <div className="page-container">
        <LineLinkageEntry
          locale={locale}
          status={lineLinkage}
          result={lineLinkResult}
          canLink={auth.shopify}
        />
      </div>
    </>
  );
}

/**
 * Parse LINE user cookie to get display name.
 * The cookie stores JSON: { displayName: string }
 *
 * 取れなくても認証は落とさない (`line_session` が認証の正本)。名前の行が消えるだけ。
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
 * LINE だけでログインしている人の描画モデル。
 *
 * Shopify 側 (注文履歴・定期便・お支払い方法) は顧客トークンが無いので **引かない**。
 * 引けないものを空配列で埋めているのであって、「0 件だった」ではない — 画面側は
 * カタログを見て「連携が要る」と言う (空状態の文言は出さない)。
 */
async function loadLineOnlyAccountView(displayName: string | null): Promise<AccountView> {
  const activity = await loadActivity();

  return {
    displayName,
    email: null,
    upcoming: buildUpcoming({ subscriptions: [], events: activity.events }),
    continueItems: buildContinueItems(activity.favorites),
    past: [],
    paymentMethod: null,
    seeded: false,
  };
}

/**
 * Firestore 側 (お気に入り / イベント申込) を server component から直接読む。
 * 既存の /api/user/* と同じ関数・同じ userKey を使う (二重定義しない)。
 * `resolveIdentity()` は Shopify / LINE どちらの識別子でも解決するので、
 * この経路は両方のログイン方法で動く。
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
