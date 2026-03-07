import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ARTICLES_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function JournalPage() {
  const t = useTranslations("journal");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-2">{t("title")}</h1>
      <p className="text-muted text-[14px] mb-12">{t("description")}</p>
      <ArticlesList />
    </div>
  );
}

async function ArticlesList() {
  const locale = await getLocale();

  try {
    const client = getClient();
    const articles = await client.fetch(ARTICLES_QUERY, {
      language: locale,
      start: 0,
      end: 20,
    });

    if (!articles || articles.length === 0) {
      return (
        <p className="text-muted text-[14px]">
          まだ記事がありません。Sanity Studio から記事を作成してください。
        </p>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
        {articles.map(
          (article: {
            _id: string;
            slug: { current: string };
            mainImage?: { asset: object; alt?: string };
            category?: { title: string };
            title: string;
            memberOnly?: boolean;
            excerpt?: string;
            publishedAt?: string;
          }) => (
            <Link
              key={article._id}
              href={`/journal/${article.slug.current}`}
              className="group block"
            >
              <div className="aspect-[3/2] bg-surface mb-4 overflow-hidden">
                {article.mainImage?.asset ? (
                  <Image
                    src={urlFor(article.mainImage).width(600).height(400).url()}
                    alt={article.mainImage.alt || article.title}
                    width={600}
                    height={400}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-light text-[13px]">
                    {article.title}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                {article.category && (
                  <p className="text-[12px] text-light uppercase tracking-wider">
                    {article.category.title}
                  </p>
                )}
                <h3 className="text-[14px] font-medium leading-snug group-hover:underline">
                  {article.memberOnly && (
                    <span className="text-[12px] text-muted mr-1.5">[会員限定]</span>
                  )}
                  {article.title}
                </h3>
                {article.excerpt && (
                  <p className="text-[13px] text-muted line-clamp-2">
                    {article.excerpt}
                  </p>
                )}
                {article.publishedAt && (
                  <p className="text-[12px] text-light">
                    {new Date(article.publishedAt).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </div>
            </Link>
          )
        )}
      </div>
    );
  } catch {
    return (
      <p className="text-muted text-[14px]">
        記事を読み込めませんでした。Sanity の接続設定を確認してください。
      </p>
    );
  }
}
