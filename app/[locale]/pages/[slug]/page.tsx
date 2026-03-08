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
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!page) notFound();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="mb-12">{page.title}</h1>
      {page.body && <PortableText value={page.body} />}
    </div>
  );
}
