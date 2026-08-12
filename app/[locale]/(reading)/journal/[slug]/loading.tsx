import { getTranslations } from "next-intl/server";

import { ArticlePageSkeleton } from "@/components/journal/journal-skeleton";

/**
 * 記事詳細のローディング (A7)。Sanity の記事取得と会員ティア判定が終わるまで、
 * 実ページと同じ骨格 (本文カラム 640 + 裁ち落とし写真) を出す。
 */
export default async function Loading() {
  const t = await getTranslations("journal");
  return <ArticlePageSkeleton loadingLabel={t("loading")} />;
}
