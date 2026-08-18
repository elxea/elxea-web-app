import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Sprout } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/media/image-card";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { EVENTS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { previewSeedEnabled, seedEvents } from "@/lib/preview-seed";
import { isPastEvent, isSameEventDay } from "@/lib/format-date";
import { filterOutFictional } from "@/lib/fictional-content";

/** 一覧カード 1 件が使うフィールド (Sanity / preview seed の共通部分)。 */
type EventCard = {
  _id: string;
  slug: { current: string };
  imageUrl?: string;
  image?: { asset: object; alt?: string };
  title: string;
  date: string;
  endDate?: string;
  location?: string;
  memberOnly?: boolean;
  externalUrl?: string;
};

export default function EventsPage() {
  const t = useTranslations("common");
  const te = useTranslations("event");

  return (
    <div className="section-wide">
      {/* 変A: centered editorial header */}
      <div className="text-center mb-12 md:mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Events
        </p>
        <h1>{t("events")}</h1>
        {te("lead") && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto mt-6">{te("lead")}</p>
        )}
      </div>
      <EventsList />
    </div>
  );
}

async function EventsList() {
  const locale = await getLocale();
  const t = await getTranslations("event");
  const tCommon = await getTranslations("common");

  try {
    const client = getClient();
    const published = await client.fetch(EVENTS_QUERY, { language: locale });

    // Hide the fictional/seed events (bodies contain "ダミー") still present
    // in the production dataset. Code-only; no Sanity mutation.
    const fetched: typeof published = filterOutFictional("event", published);

    // Preview-only: the production dataset has no future events, so the list is
    // empty. Fall back to the shared seed events (same 3 as the top page) so the
    // layout can be reviewed. No effect when the flag is unset.
    const source =
      (!fetched || fetched.length === 0) && previewSeedEnabled()
        ? seedEvents()
        : fetched;

    // 開催が終わったイベントは一覧に出さない (Sanity のデータは消さない)。
    // `EVENTS_QUERY` 側にも `coalesce(endDate, date) >= now()` があるが、それを通らない経路が
    // 残っている: preview seed は固定日付なので時間が経てば過去になるし、
    // 取得側を差し替えれば GROQ のフィルタごと外れる。**表示する直前**でもう
    // 一度落として、どの経路から来ても過去日のカードが並ばないようにする。
    const events = ((source ?? []) as EventCard[]).filter(
      (event) => !isPastEvent(event.date, event.endDate)
    );

    if (!events || events.length === 0) {
      /* P1 一覧そのものが空。障害 (loadError) とは必ず出し分ける — 再試行では
         なく横に抜ける出口 (商品一覧) を出す。他の P1 一覧 (farmers /
         tea-menu / collections 等) と同じ EmptyState + 4 部構成キーに揃える。 */
      return (
        <EmptyState
          className="mt-8 lg:mt-12"
          icon={Sprout}
          count={t("empty.eyebrow")}
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            <Link href="/products" className={pillClass("outline")}>
              {t("empty.ctaLabel")}
            </Link>
          }
        />
      );
    }

    return (
      // 変A: image-top card grid (page-local card). PC 3col / SP 1col.
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
        {events.map(
          (event) => {
            const cardClass = "group block";
            const inner = (
              <>
                <div className="relative mb-4">
                  <ImageCard
                    image={event.imageUrl ?? (event.image?.asset ? urlFor(event.image).width(600).height(400).url() : undefined)}
                    alt={event.title}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    hover
                  />
                  {event.memberOnly && (
                    <span className="absolute top-3 left-3 bg-foreground text-background text-[10px] uppercase tracking-[0.15em] px-2 py-1">
                      {tCommon("memberOnly")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {new Date(event.date).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  {/* 一覧カードは日付だけを出す面なので、終了日は**別の日のときだけ**
                      併記する。同日開催 (例: 14:00–17:00) で無条件に併記すると
                      「2026年8月10日 — 2026年8月10日」と同じ日付を 2 回描くため。
                      時刻レンジは詳細側 (`formatEventSchedule`) が受け持つ。 */}
                  {event.endDate &&
                    !isSameEventDay(event.date, event.endDate) &&
                    ` — ${new Date(event.endDate).toLocaleDateString(locale, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}`}
                </p>
                <h3 className="text-sm font-medium leading-relaxed group-hover:underline underline-offset-4 mb-1.5">
                  {event.title}
                </h3>
                {event.location && (
                  <p className="text-sm text-muted-foreground">
                    {t("locationLabel")}：{event.location}
                  </p>
                )}
              </>
            );

            // 見本カード (seed) も `seedEventDetail()` が `/events/[slug]` を
            // 解決できるようになったので通常どおり詳細へリンクする (C7-1)。
            // 以前は詳細ルートが無く非リンクにしていた。
            if (event.externalUrl) {
              return (
                <a
                  key={event._id}
                  href={event.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClass}
                >
                  {inner}
                </a>
              );
            }

            return (
              <Link
                key={event._id}
                href={`/events/${event.slug.current}`}
                className={cardClass}
              >
                {inner}
              </Link>
            );
          }
        )}
      </div>
    );
  } catch {
    return (
      <p className="text-muted-foreground text-sm">
        {t("loadError")}
      </p>
    );
  }
}
