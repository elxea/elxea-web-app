import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { EVENT_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();

  let event;
  try {
    const client = getClient();
    event = await client.fetch(EVENT_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-muted">イベント情報を読み込めませんでした。</p>
      </div>
    );
  }

  if (!event) notFound();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <header className="mb-12">
        <p className="text-[12px] text-light mb-4">
          {new Date(event.date).toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {event.endDate &&
            ` — ${new Date(event.endDate).toLocaleDateString("ja-JP", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}`}
        </p>
        <h1 className="mb-4">{event.title}</h1>
        {event.location && (
          <p className="text-muted text-[14px]">{event.location}</p>
        )}
        {event.memberOnly && (
          <p className="text-[12px] text-muted mt-4">[会員限定イベント]</p>
        )}
      </header>

      {event.image?.asset && (
        <div className="mb-12">
          <Image
            src={urlFor(event.image).width(1200).url()}
            alt={event.title}
            width={1200}
            height={675}
            className="w-full"
            priority
          />
        </div>
      )}

      {event.description && <PortableText value={event.description} />}

      {event.externalUrl && (
        <div className="mt-12">
          <a
            href={event.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
          >
            詳細・申し込み →
          </a>
        </div>
      )}
    </div>
  );
}
