import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { FARMER_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";

export default async function FarmerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();

  let farmer;
  try {
    const client = getClient();
    farmer = await client.fetch(FARMER_BY_SLUG_QUERY, {
      slug,
      language: locale,
    });
  } catch {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-muted">プロフィールを読み込めませんでした。</p>
      </div>
    );
  }

  if (!farmer) notFound();

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Photo */}
        {farmer.photo?.asset ? (
          <div className="aspect-square bg-surface overflow-hidden">
            <Image
              src={urlFor(farmer.photo).width(800).height(800).url()}
              alt={farmer.photo.alt || farmer.name}
              width={800}
              height={800}
              className="w-full h-full object-cover"
              priority
            />
          </div>
        ) : (
          <div className="aspect-square bg-surface" />
        )}

        {/* Info */}
        <div>
          {(farmer.region || farmer.country) && (
            <p className="text-[12px] text-light uppercase tracking-wider mb-4">
              {[farmer.region, farmer.country].filter(Boolean).join(", ")}
            </p>
          )}
          <h1 className="mb-8">{farmer.name}</h1>
          {farmer.bio && <PortableText value={farmer.bio} />}
        </div>
      </div>
    </div>
  );
}
