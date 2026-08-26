import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";
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
import { FavoritesBoard } from "@/components/account/favorites-board";
import { FavoritesSeed } from "@/components/favorites/favorites-seed";
import {
  favoriteKeysOf,
  groupFavorites,
  normalizeFavorites,
  type FavoriteGroup,
} from "@/lib/account-favorites";
import {
  ACCOUNT_SECTION_ORDER,
  canRenderAccountShell,
  isAvailable,
  isSignedIn,
  splitSectionItems,
  type AccountAuth,
  type AccountItem,
  type AccountSectionId,
} from "@/lib/account-capabilities";
import {
  buildAccountView,
  buildUpcoming,
  formatRecordDate,
  type AccountRecord,
  type AccountView,
} from "@/lib/account-view";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { getEventRegistrations, getFavorites } from "@/lib/firebase/server-actions";
import { previewSeedEnabled, seedAccountView } from "@/lib/preview-seed";
import { AccountPageSkeleton } from "@/components/account/account-skeleton";
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
 *   4. お気に入り          商品 / 読みもの / 人 / 農家を分類ごとに全件 + 解除
 *   5. これまで            注文履歴 (RecordCard)
 *   6. お支払い方法        ご登録のカード (PaymentMethodCard) + 変更は外部リンク 1 本
 *   7. LINE 連携           連携状態 + 入口 or 解除 (LineLinkageEntry)
 *   8. AccountOpsBand      契約・お支払い・お届け先の案内 + CTA
 *
 * ## 連携の入口はこの画面に 1 つだけ (F16)
 *
 * 連携・ログインを促す導線は 7 の `LineLinkageEntry` **だけ** が持つ。使えない項目の
 * カード (`AccountLockedCard`) は理由だけを言い、行動リンクを持たない。以前は
 * Shopify が要る 3 項目それぞれが同じ導線を 1 本ずつ持っていたため、LINE だけで
 * 使っている人の画面に同じ入口が 4 本並んでいた (Setaka 実機指摘 2026-08-25)。
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
/**
 * ## 画面の骨格は待たずに返す (TTFB / W-B)
 *
 * この関数は **cookie しか読まない**。Shopify / Firestore / cx-agent への往復は
 * すべて `<Suspense>` の内側 (`AccountBody`) に落としてあるので、サーバは見出しと
 * 骨組みを先に流し、中身は届いた順に差し込む。
 *
 * 以前はここで `getCustomerFromSession()` を待ち切ってから HTML を書き始めていた。
 * Shopify の顧客照会 1 往復がまるごと TTFB に乗るので、実測で 2.2〜3.2 秒のあいだ
 * **前のページが出たまま何も起きない**状態が続いていた (監査 #5 / 2026-08-25)。
 * 待ち時間そのものが短くなるわけではないが、待っている場所が「白紙の前」から
 * 「マイページの骨格の中」に移る。
 *
 * ログイン判定をここで cookie だけに落としても認証は緩まない。`middleware.ts` の
 * /account ガードが見ているのと同じ cookie を、同じ条件で見ているだけで、
 * **何を出してよいか**の判定 (`AccountAuth`) は従来どおり `AccountBody` の中で
 * 実データ (`customer`) を得てから行う。ここは「マイページを描き始めてよいか」
 * だけを決める。
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
  const cookieStore = await cookies();

  /* middleware の /account ガードと同じ cookie・同じ条件。ここを通っても
     「ログイン済み」と断定はしない (下の AccountBody が実データで確定する)。 */
  const hasShopifySession =
    cookieStore.has("shop_at") && cookieStore.has("shop_rt");
  const hasLineSession = cookieStore.has("line_session");

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ) は実セッションを持たないので、
     cookie が 1 つも無くても骨格を出す必要がある。 */
  if (
    !canRenderAccountShell({
      hasShopifySession,
      hasLineSession,
      previewSeed: previewSeedEnabled(),
    })
  ) {
    return (
      <AccountLoginPrompt
        title={tCommon("account")}
        body={t("loginRequired")}
        loginLabel={tCommon("login")}
        locale={locale}
      />
    );
  }

  return (
    <Suspense fallback={<AccountPageSkeleton title={tCommon("account")} loadingLabel={t("loading")} />}>
      <AccountBody searchParams={searchParams} />
    </Suspense>
  );
}

/** ログインを促す画面。骨格側と本体側の両方が使うので 1 か所に置く。 */
function AccountLoginPrompt({
  title,
  body,
  loginLabel,
  locale,
}: {
  title: string;
  body: string;
  loginLabel: string;
  locale: string;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
      <div className="max-w-sm text-center">
        <h1 className="page-title mb-4 text-foreground">{title}</h1>
        <p className={cn(captionClass, "mb-8 text-muted-foreground")}>{body}</p>
        <Button variant="outline" asChild>
          <a href={`/${locale}/login`}>{loginLabel}</a>
        </Button>
      </div>
    </div>
  );
}

/**
 * 「今は判定できない」画面 (設計憲章 R1)。
 *
 * `AccountLoginPrompt` と**別に置いてある**のが要点。見た目は似ているが言っている
 * ことが違う — あちらは「あなたはログインしていない」、こちらは「こちらの都合で
 * 確かめられなかった」。前者を後者に使うと、ログイン済みの人に無意味な再ログインを
 * 指示することになる (しかも直らない)。
 *
 * 再試行は同じ URL への素のリンク。Server Component なので `reset()` は使えないが、
 * 再訪すればもう一度 Shopify を引き直すので、実質は同じことができる。
 * ログイン導線も残す — 本当に期限切れだった場合の逃げ道として。
 */
function AccountUnavailablePrompt({
  title,
  body,
  retryLabel,
  loginLabel,
  locale,
}: {
  title: string;
  body: string;
  retryLabel: string;
  loginLabel: string;
  locale: string;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
      <div className="max-w-sm text-center">
        <h1 className="page-title mb-4 text-foreground">{title}</h1>
        <p className={cn(captionClass, "mb-8 text-muted-foreground")}>{body}</p>
        <div className="flex justify-center gap-4">
          <Button variant="outline" asChild>
            <a href={`/${locale}/account`}>{retryLabel}</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/${locale}/login`}>{loginLabel}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * マイページの中身。**外部往復はすべてここから下**にある。
 * 判定・描画の中身は従来と 1 行も変えていない (置き場所だけを Suspense の内側に移した)。
 */
async function AccountBody({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  /* 3 値で受ける (設計憲章 R1)。以前はここが try/catch で、Shopify が答えなかった
     ときも `customer = null` に潰れていた。下の `isSignedIn` 判定は null を
     「Shopify ログインなし」と読むので、**Shopify の一時障害がそのまま
     「ログインしてください」画面**になっていた — ログイン済みの人を追い返す形で。 */
  const customerResult = await getCustomerFromSession();
  const customer: Customer | null = customerResult.ok ? customerResult.data : null;
  /** 顧客を引けなかった (= 未ログインだと**断定できない**)。 */
  const shopifyUndetermined = !customerResult.ok;

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
    /* 「ログインしていない」と「判定できなかった」で出す画面を分ける。
     *
     * 判定できなかった人に `loginRequired` を出すのが以前の割れ方だった。
     * その人は cookie を持っている (`middleware.ts` の /account ガードを
     * 通ってここまで来ている) ので、ログインし直しても同じ画面に戻る —
     * 直せない指示を出していたことになる。時間を置けば直るのだから、
     * そう言うべきである。 */
    if (shopifyUndetermined) {
      return (
        <AccountUnavailablePrompt
          title={tCommon("account")}
          body={t("networkError")}
          retryLabel={tCommon("retry")}
          loginLabel={tCommon("login")}
          locale={locale}
        />
      );
    }

    return (
      <AccountLoginPrompt
        title={tCommon("account")}
        body={t("loginRequired")}
        loginLabel={tCommon("login")}
        locale={locale}
      />
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

  /* 保存トグルの初期値。マイページは元々「人ごとに毎回作る」描画なので、一覧は
     既にサーバの手元にある (`loadActivity` は `React.cache` で 1 回に畳んである)。
     渡しておけば、この画面の保存トグルは往復ゼロで 1 枚目から状態が確定する。
     PREVIEW_SEED の見本表示では実セッションが無いので渡さない。 */
  /* お気に入りは 1 回だけ読み (`loadActivity` は `React.cache` で畳んである)、
     2 つの用途に配る — 画面に出す分類別の一覧と、保存トグルへ渡す初期値。
     見本表示 (PREVIEW_SEED) では実セッションが無いので節ごと出さない。 */
  const rawFavorites = seeded ? [] : (await loadActivity()).favorites;
  const favoriteKeys = favoriteKeysOf(rawFavorites);
  const favoriteGroups: FavoriteGroup[] | null = seeded
    ? null
    : groupFavorites(normalizeFavorites(rawFavorites));

  /* 連携フロー (P2) から戻ってきた直後の結果。値は 2 つだけを許し、それ以外は無視する
     (任意の文字列を画面の分岐に持ち込ませない)。表示は LineLinkageEntry の中に閉じ、
     専用の完了画面は作らない。 */
  const resolvedSearchParams = (await searchParams) ?? {};
  const rawLineLink = resolvedSearchParams[LINK_RESULT_PARAM];
  const lineLinkResult =
    rawLineLink === "success" ||
    rawLineLink === "error" ||
    rawLineLink === "conflict" ||
    rawLineLink === "line-conflict"
      ? rawLineLink
      : undefined;

  /* ログイン済みで /login を開いた人を middleware がここへ送ったときの印。
     飛ばした理由をその場で 1 行だけ告げる (黙って行き先を変えない)。 */
  const showSignedInNotice = resolvedSearchParams.notice === "already-signed-in";

  /* Shopify 顧客アカウントポータルへの外部リンク。LINE だけの人はポータルの
     セッションを持たないので出さない (押しても入れない導線を置かない)。 */
  const portalUrl = auth.shopify ? customerAccountPortalUrl() : null;

  /* 会員ランク (フリー / スタンダード / プレミアム) の表示は持たない。
   * elxea は会員制度を持たず、会員かどうかは「roji 契約の有無」の二値である
   * (Setaka 確定 2026-08-17 / main #62)。 */

  const recordDate = (record: AccountRecord) => formatRecordDate(record.date, locale);

  /** 注文カードの 3 行目。金額と入金状態を 1 行に畳む。 */
  const orderNote = (record: AccountRecord): string | undefined => {
    const price = record.amount
      ? formatPrice(record.amount.value, record.amount.currencyCode)
      : undefined;
    switch (record.status) {
      case "refunded":
        return t("pastOrderRefunded");
      case "voided":
        return t("pastOrderVoided");
      case "partiallyRefunded":
        return price
          ? `${price} ${t("pastOrderPartiallyRefunded")}`
          : t("pastOrderPartiallyRefunded");
      default:
        return price;
    }
  };

  /** 使えない項目 1 件をグレーのカードにする。**理由だけを言い、行動は持たない。**
   *
   * ## なぜ行動リンクを外したか (連携の入口は 1 つ / F16)
   *
   * Shopify の顧客トークンが要る項目は 3 つある (定期便・注文履歴・お支払い方法)。
   * LINE だけでログインしている人にはその 3 つが同時に locked になるので、以前は
   * **同じ導線が 1 画面に 3 本並んでいた** — 文言も行き先も 1 文字違わず同じ
   * (`connectShopifyButton` → `/api/auth/login`)。加えて画面末尾の
   * `LineLinkageEntry` にも入口があるので、実測で 1 画面に 4 本 (Setaka 実機指摘
   * 2026-08-25「連携する箇所って 1 箇所だけでいい。3 箇所ぐらいある。使いにくい」)。
   *
   * しかも 3 本のほうは **劣ったコピー** だった。行き先の `/api/auth/login` は
   * Shopify にログインさせるだけで連携は起こさない (だから J-1 案B でラベルから
   * 「連携」を外した経緯がある) のに対し、`LineLinkageEntry` のワンタップ
   * (`/api/user/line-link/intent`, J-1 案A) は戻ってきた時点で台帳に行が立つ。
   * 残すなら後者で、消えるのは前者。ワンタップの決裁済みフローは触っていない
   * (入口が 1 つになるだけ)。
   *
   * カードそのものは消さない。「なぜ今これが見えないのか」をその場で言う役目は
   * 変わらず要る (項目を消すと、存在自体が見えなくなる)。理由だけを残し、
   * 「では何をすればよいか」は画面に 1 つだけある入口が引き受ける。
   *
   * カタログの `lockedAction` は残してある — 定期便の専用ページ
   * (`/account/subscriptions`) は 1 画面 1 項目で重複が起きず、そこでは行動を
   * 出すのが正しいため。`lockedActionFor("subscriptions")` がそれを引く唯一の口。 */
  const lockedCard = (item: AccountItem) => (
    <AccountLockedCard
      key={item.id}
      title={t(item.lockedTitleKey)}
      reason={t(item.lockedReasonKey)}
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

    /* 4. お気に入り — **分類ごとに、この画面で直接**出す。
       ここは以前「続き」という抜粋 6 枚で、全件・種類別・解除は
       /account/favorites という別ページが引き受けていた。自分が保存したものを
       見るのに 1 回よけいに遷移が要り、抜粋に入らなかった種類はマイページから
       存在ごと見えなかった (Setaka 実機指摘 2026-08-25)。別ページは本ページへの
       恒久リダイレクトにし、中身をここへ移した。
       解除の状態を持つのは `FavoritesBoard` 側だけ (件数の出どころを 2 つに
       分けると、解除したのに件数だけ古いままになる = F14 の再発)。 */
    favorites: (() => {
      const { locked } = splitSectionItems("favorites", auth);
      if (favoriteGroups === null) return null;
      return (
        <>
          <FavoritesBoard groups={favoriteGroups} />
          {locked.length > 0 ? (
            <AccountCardGrid columns={2}>{locked.map(lockedCard)}</AccountCardGrid>
          ) : null}
        </>
      );
    })(),

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
                  /* 返金・無効化された注文は Customer Account API の totalPrice が
                     0 になる。金額だけを出すと「¥0 で買った」ように読めるので、
                     金額の代わりに状態を言う (一部返金は金額と併記して、いま
                     いくらの扱いなのかを両方見せる)。 */
                  note={orderNote(record)}
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
      {/* 保存トグルへ渡す初期値 (描画はしない)。サーバが既に知っている一覧を
          そのまま渡すので、この画面のトグルは往復ゼロで状態が確定する。 */}
      <FavoritesSeed keys={favoriteKeys} />

      {showSignedInNotice ? (
        <p
          role="status"
          className={cn(
            captionClass,
            "page-container pt-4 text-muted-foreground lg:pt-6"
          )}
        >
          {t("alreadySignedInNotice")}
        </p>
      ) : null}

      <AccountTitleBlock
        title={tCommon("account")}
        /* 誰として入っているかの 1 行。
           メール → 表示名 → 「LINE で接続中」の順に落とす。送信専用アドレス
           (no-reply@…) は本人の識別子ではないので `buildAccountView` の時点で
           落としてあり、ここには届かない (#12)。 */
        identity={
          view.email
            ? t("loggedInAs", { email: view.email })
            : view.displayName
              ? t("loggedInAsName", { name: view.displayName })
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

      {/* 8. LINE 連携 —— **この画面で連携の話をする唯一の場所** (F16)。

          LINE 連携エントリ (Web 側導線 / Phase 2 + 連携状態表示 / P1 + LINE ログイン中の
          解除導線 / A 案)。**ログイン経路で節ごと消さない** — 以前はここが `auth.shopify`
          だったため、LINE で入っている人は連携済みでも解除に到達できなかった。

          ワンタップ (J-1 案A) を入れたことで、この節は **どの状態でも必ず出る**。
          以前は「LINE セッションで未連携」のときだけ節ごと畳んでいた (`hidden`) が、
          その結果 LINE だけで使っている人のマイページに連携の入口が 1 つも無かった。
          何をどう出すかの判断は 1 か所 (`resolveLineLinkageEntryMode`) が持ち、
          ここは枠を置くだけにする。

          ## なぜここ (お支払い方法の下・締めの案内帯の上) なのか

          連携の入口は **状態と対で置く**。この節は「連携済みか / いつからか / 解除」を
          同時に持つ唯一の節で、状態を出せない場所 (locked カード) に入口だけを置くと、
          連携済みの人にも同じボタンが見える or 状態が 2 か所に分かれてずれる。

          位置は「アカウントの設定ゾーン」に寄せた。ページ冒頭のバナーにはしない
          (押し売りにしない・確定版 Figma の節構成を頭から崩さない)。末尾の案内帯
          (`AccountOpsBand`) は締めの一言なので、その **上** に置いて設定ゾーンを
          連続させる。以前はこの節が案内帯の後ろに独りで置かれていて、締めたあとに
          もう 1 節続く読み味になっていた。 */}
      <div className="page-container">
        <LineLinkageEntry
          locale={locale}
          status={lineLinkage}
          result={lineLinkResult}
          canLink={auth.shopify}
        />
      </div>

      {/* 9. 末尾の案内帯。定期便を触れない人に「管理する」ボタンは出さない
          (押した先で「連携が必要です」に当たるだけなので)。 */}
      <AccountOpsBand note={t("opsNote")}>
        {isAvailable("subscriptions", auth) ? (
          <AccountCta label={t("manageSubscription")} href="/account/subscriptions" />
        ) : null}
      </AccountOpsBand>
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

/**
 * 実データ (Shopify + Firestore) からマイページの描画モデルを組む。
 *
 * 定期便が引けなかったときも `[]` で組む点は従来どおり (画面の骨格を壊さない) が、
 * **理由は握り潰さない**。以前の `.catch(() => [])` は catch の中で何もしないので、
 * 契約中の顧客に「予定なし」と表示していてもサーバー側に痕跡が残らなかった。
 * いまは `getSubscriptionsFromSession` が Sentry に送るので、後から数えられる。
 */
async function loadAccountView(customer: Customer): Promise<AccountView> {
  const [subscriptionsResult, activity] = await Promise.all([
    getSubscriptionsFromSession(),
    loadActivity(),
  ]);

  return buildAccountView({
    customer,
    subscriptions: subscriptionsResult.ok ? subscriptionsResult.data : [],
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
 *
 * **1 リクエスト 1 回に畳んである** (`React.cache`)。描画モデルの組み立てと、
 * 保存トグルへ渡す初期値 (`FavoritesSeed`) の両方がこれを読むので、畳まないと
 * 同じ Firestore の読みが 2 回出る。
 */
const loadActivity: () => Promise<{
  favorites: Awaited<ReturnType<typeof getFavorites>>;
  events: Awaited<ReturnType<typeof getEventRegistrations>>;
}> = cache(loadActivityUncached);

async function loadActivityUncached(): Promise<{
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
