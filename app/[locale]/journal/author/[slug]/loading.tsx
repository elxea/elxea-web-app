import { getTranslations } from "next-intl/server";

import { JournalListPageSkeleton } from "@/components/journal/journal-skeleton";

/** 著者ページのローディング (A7)。著者ページにサイドバーは無い。 */
export default async function Loading() {
  const t = await getTranslations("journal");
  return <JournalListPageSkeleton loadingLabel={t("loading")} withRail={false} />;
}
