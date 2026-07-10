import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { PAGE_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { PortableText } from "@/components/sanity/portable-text";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const page = await client.fetch(PAGE_BY_SLUG_QUERY, { slug, language: locale });
    if (!page) return {};
    return { title: page.title };
  } catch {
    return {};
  }
}

export default async function GenericPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("page");

  let page;
  try {
    const client = getClient();
    page = await client.fetch(PAGE_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 md:px-6 md:py-28">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!page) notFound();

  return (
    <>
      {/* Title band (変A / 中央寄せヘッダー) */}
      <div className="bg-muted">
        <div className="mx-auto max-w-3xl px-5 py-16 text-center md:px-6 md:py-24">
          <div className="flex flex-col gap-4 md:gap-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Page
            </p>
            <h1>{page.title}</h1>
          </div>
        </div>
      </div>

      {/* Body (変A Reading Column / CMS 描画温存) */}
      <div className="mx-auto max-w-3xl px-5 py-16 pb-20 md:px-6 md:py-24 md:pb-32">
        {page.body && <PortableText value={page.body} />}
      </div>
    </>
  );
}
