import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { FARMER_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { FollowButton } from "@/components/farmers/follow-button";
import { CommentSection } from "@/components/community/comment-section";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const farmer = await client.fetch(FARMER_BY_SLUG_QUERY, { slug, language: locale });
    if (!farmer) return {};
    const image = farmer.photo?.asset ? urlFor(farmer.photo).width(800).url() : undefined;
    const location = [farmer.region, farmer.country].filter(Boolean).join(", ");
    return {
      title: farmer.name,
      description: location || farmer.name,
      openGraph: {
        title: farmer.name,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function FarmerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("farmer");
  const tCommon = await getTranslations("common");
  const tComment = await getTranslations("comment");

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
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!farmer) notFound();

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Photo */}
        {farmer.photo?.asset ? (
          <div className="aspect-square bg-muted overflow-hidden">
            <Image
              src={urlFor(farmer.photo).width(800).height(800).url()}
              alt={farmer.photo.alt || farmer.name}
              width={800}
              height={800}
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="w-full h-full object-cover"
              priority
            />
          </div>
        ) : (
          <div className="aspect-square bg-muted" />
        )}

        {/* Info */}
        <div>
          {(farmer.region || farmer.country) && (
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
              {[farmer.region, farmer.country].filter(Boolean).join(", ")}
            </p>
          )}
          <h1 className="mb-8">{farmer.name}</h1>

          {/* Follow button */}
          <div className="mb-8">
            <FollowButton
              farmerSlug={slug}
              farmerName={farmer.name}
              farmerImageUrl={
                farmer.photo?.asset
                  ? urlFor(farmer.photo).width(80).height(80).url()
                  : null
              }
              followLabel={t("follow")}
              unfollowLabel={t("unfollow")}
              followedMessage={t("followedMessage")}
              unfollowedMessage={t("unfollowedMessage")}
              errorMessage={tCommon("error")}
              loginRequiredMessage={tCommon("loginRequired")}
            />
          </div>

          {farmer.bio && <PortableText value={farmer.bio} />}
        </div>
      </div>

      {/* Comment section for farmer profile */}
      <CommentSection
        targetType="farmer"
        targetId={slug}
        locale={locale}
        i18n={{
          title: tComment("title"),
          placeholder: tComment("placeholder"),
          submit: tComment("submit"),
          submitting: tComment("submitting"),
          loginRequired: tComment("loginRequired"),
          postedMessage: tComment("postedMessage"),
          deletedMessage: tComment("deletedMessage"),
          errorPosting: tComment("errorPosting"),
          errorDeleting: tComment("errorDeleting"),
          noComments: tComment("noComments"),
          delete: tComment("delete"),
          characterCount: tComment("characterCount"),
          moderation: tComment("moderation"),
        }}
      />
    </div>
  );
}
