import { getTranslations } from "next-intl/server";

import { JournalListPageSkeleton } from "@/components/journal/journal-skeleton";

/** カテゴリページのローディング (A7)。 */
export default async function Loading() {
  const t = await getTranslations("journal");
  return <JournalListPageSkeleton loadingLabel={t("loading")} />;
}
