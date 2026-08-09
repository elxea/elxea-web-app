import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { EVENT_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { getMembershipTier } from "@/lib/shopify/auth";
import type { MembershipTier } from "@/lib/shopify/customer";
import { MemberGate } from "@/components/ui/member-gate";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import {
  EventBody,
  EventBodyHeading,
  EventDetailHeader,
  EventDetailPage,
  EventDetailStack,
  EventDetailTitle,
  EventDetailsLink,
  EventEyebrow,
  EventFactCard,
  EventFactDivider,
  EventFactRow,
  EventHero,
  EventRegistrationCard,
  EventRegistrationNote,
} from "@/components/events/event-detail";
import {
  EventRegisterButton,
  EventRegistrationProvider,
  EventStickyRegisterBar,
} from "@/components/events/event-register-button";
import { formatEventSchedule } from "@/lib/format-date";
import { seedEventDetail } from "@/lib/preview-seed";

/**
 * イベント詳細 — Figma【R2: 確定版】section 6657:7931
 * (PC frame 6657:7932 / SP frame 6662:8160) の実装。
 *
 * 確定版の 5 ブロック構成をそのまま節にする:
 *   1. Breadcrumb   ホーム / イベント / イベント名
 *   2. Event Header キッカー + 会員限定バッジ + 見出し + 日時・開催地カード
 *   3. Hero         主画像 (PC 16:7 / SP 3:2)
 *   4. Registration 参加登録カード (全幅 CTA + 会員限定の注記 + 必要なら MemberGate)
 *   5. Body         詳細・申し込み (本文 + 外部リンク)
 * SP のみ 6 番目として Sticky Register Bar 6664:13496 (追従 CTA) が載る。
 *
 * データが無い節は枠ごと出さない (画像なし → Hero を出さない / 本文も外部リンクも
 * 無ければ Body を出さない)。文言は Figma 正本を messages の event.* / common.* に
 * 写して参照する (ページ内に文言を焼かない)。
 *
 * 会員限定の扱い: Figma のフレームは「バッジ + 登録カード + 注記」を常時見せる
 * 構成なので、ヘッダー / Hero / 登録カードは権限に関係なく出す。ただし
 * **既存の tier ゲートは緩めない** — 詳細本文 (Body) だけは権限が無いときに
 * MemberGate と入れ替える。R2 に合わせる過程で非会員への新たな情報露出を作らない。
 */

/** Sanity の image オブジェクト or preview seed の imageUrl を 1 本の URL に寄せる。 */
function resolveEventImage(event: {
  image?: { asset?: object } | null;
  imageUrl?: string;
}): string | null {
  if (event.imageUrl) return event.imageUrl;
  if (event.image?.asset) return urlFor(event.image).width(1280).url();
  return null;
}

/** 実データ → (空なら) preview seed の見本詳細。seed はフラグ未設定時 null。 */
async function loadEvent(slug: string, locale: string) {
  try {
    const client = getClient();
    const fetched = await client.fetch(EVENT_BY_SLUG_QUERY, {
      slug,
      language: locale,
    });
    return { event: fetched ?? seedEventDetail(slug), failed: false };
  } catch {
    return { event: null, failed: true };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const { event } = await loadEvent(slug, locale);
  if (!event) return {};

  const image = resolveEventImage(event);
  return {
    title: event.title,
    description: event.location ? `${event.title} — ${event.location}` : event.title,
    openGraph: {
      title: event.title,
      images: image ? [{ url: image }] : [],
    },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("event");
  const tCommon = await getTranslations("common");

  const { event, failed } = await loadEvent(slug, locale);

  if (failed) {
    return (
      <EventDetailPage>
        <p className="text-muted-foreground">{t("loadError")}</p>
      </EventDetailPage>
    );
  }

  if (!event) notFound();

  // 会員限定の判定。バッジと注記は Figma どおり memberOnly / tier のどちらかが
  // 立っていれば出す。本文ゲートは従来どおり tier で判定する。
  const requiredTier: MembershipTier =
    event.requiredTier ?? (event.memberOnly ? "standard" : "none");
  const isGated = requiredTier !== "none";
  const isMemberOnly = Boolean(event.memberOnly) || isGated;
  const userTier = isGated
    ? await getMembershipTier()
    : ("none" as MembershipTier);
  const tierRank: Record<MembershipTier, number> = {
    none: 0,
    standard: 1,
    premium: 2,
  };
  const hasAccess = !isGated || tierRank[userTier] >= tierRank[requiredTier];

  const imageUrl = resolveEventImage(event);
  const schedule = formatEventSchedule(event.date, event.endDate, locale);
  const hasBody = Boolean(event.description || event.externalUrl);

  return (
    <EventDetailPage>
      {/* Figma Breadcrumb 6940:148 / 6940:154。溝は Figma 実測 (PC 64 / SP 40) */}
      <Breadcrumb
        items={[
          { label: tCommon("home"), href: "/" },
          { label: tCommon("events"), href: "/events" },
          { label: event.title },
        ]}
        locale={locale}
        className="mb-10 md:mb-16"
      />

      <EventRegistrationProvider
        eventSlug={slug}
        eventTitle={event.title}
        eventDate={event.date ?? null}
        eventImageUrl={imageUrl}
        registerLabel={t("register")}
        cancelLabel={t("cancelRegistration")}
        registeredMessage={t("registeredMessage")}
        cancelledMessage={t("cancelledMessage")}
        errorMessage={tCommon("error")}
        loginRequiredMessage={tCommon("loginRequired")}
      >
        <EventDetailStack>
          {/* 1. Event Header 6657:13352 / 6663:8166 */}
          <EventDetailHeader>
            <EventEyebrow
              label="Event"
              badge={isMemberOnly ? tCommon("memberOnly") : undefined}
            />
            <EventDetailTitle>{event.title}</EventDetailTitle>
            {(schedule || event.location) && (
              <EventFactCard>
                {schedule && (
                  <EventFactRow label={t("dateLabel")}>{schedule}</EventFactRow>
                )}
                {schedule && event.location && <EventFactDivider />}
                {event.location && (
                  <EventFactRow label={t("locationLabel")}>
                    {event.location}
                  </EventFactRow>
                )}
              </EventFactCard>
            )}
          </EventDetailHeader>

          {/* 2. Hero 6659:8002 / 6664:8160 — 画像が無ければ枠ごと出さない */}
          {imageUrl && <EventHero src={imageUrl} alt={event.title} />}

          {/* 3. Registration 6660:8002 / 6664:8163 */}
          <EventRegistrationCard id="event-registration">
            <EventRegisterButton />
            {isMemberOnly && (
              <EventRegistrationNote>
                {t("memberOnlyNotice")}
              </EventRegistrationNote>
            )}
          </EventRegistrationCard>

          {/* 4. Body 6661:13490 / 6664:8168 — 権限が無いときは MemberGate に差し替え */}
          {hasAccess
            ? hasBody && (
                <EventBody>
                  <EventBodyHeading>{t("detailsHeading")}</EventBodyHeading>
                  {event.description && (
                    // Figma 6661:13492 / 6664:8170 の本文は 16px。共有の
                    // PortableText は段落を `text-sm` で描くので、**このページ枠の
                    // 中だけ** 16px に上げる (記事本文の leading は C4-1 で確定した
                    // DS 側をそのまま使う)。
                    // 最終ブロックの下マージン落とし (`[&>*:last-child]:mb-0`) は
                    // C9-1R で共有シリアライザ側 (`last:mb-0`) に移したので削除した。
                    // 同じ漏れが農家詳細・プレイリスト・お茶メニュー詳細にもあったため、
                    // ページごとに貼るのをやめて 1 箇所で閉じている。
                    <div className="prose-custom [&_p]:text-base">
                      <PortableText value={event.description} />
                    </div>
                  )}
                  {event.externalUrl && (
                    <EventDetailsLink href={event.externalUrl}>
                      {t("detailsPageLink")}
                    </EventDetailsLink>
                  )}
                </EventBody>
              )
            : <MemberGate requiredTier={requiredTier} />}
        </EventDetailStack>

        {/*
          SP 追従 CTA 6664:13496。ページに spacer を敷かないので Figma の実寸を
          歪めない。隠す条件は「本来の登録カードが見えている間」だけにする
          (CTA が二重に見えるのを避ける目的)。

          フッターも隠す条件に入れる案は捨てた: 登録カードとフッターの間 (本文節)
          は実測 682px しかなく viewport 844px より短いため、**どの scroll 位置でも
          両方が視界から外れず追従バーが一度も出ない** (実測: 出せる scroll 窓 =
          -162px)。Figma がバーを描いている以上、常用端末で機能が死ぬ方が忠実度と
          しても不利なので、最下部でフッター末尾に重なることは追従 CTA の通常挙動
          として受け入れる (忠実度対比表の要判断に記載)。
        */}
        <EventStickyRegisterBar
          hideWhenVisibleSelectors={["#event-registration"]}
        />
      </EventRegistrationProvider>
    </EventDetailPage>
  );
}
