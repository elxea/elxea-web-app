import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ListPageHead } from "@/components/catalog/catalog-list";
import { bodyClass, bodySmClass } from "@/components/editorial/rule-list";
import {
  TastingNoteList,
  type TastingNoteRecord,
} from "@/components/karte/tasting-notes";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Link } from "@/i18n/navigation";
import { seedTastingNotes } from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * テイスティングノート /ja/tasting-note — 飲んだ記録の一覧。
 *
 * ## 正本は「お茶カルテ R2」の中にある
 *
 * Structure DB の本行が持つ Figma `6728:120` は旧 elxea 変A
 * (`テイスティングノート 変A（部品ベース）— PC/SP @/ja/tasting-note`) で R2 ではない。
 * R2 確定版セクションを全数走査すると roji R2 に**テイスティングノート単独の
 * フレームは無く**、お茶カルテ R2 (`8105:1116`) の中に
 * 「TastingNotes (飲んだ記録 / EC テイスティングノート統合)」として畳まれている
 * (PC `8105:1125` / SP `8105:1262`)。そのブロックが 4 件だけ見せて
 * 「すべての記録を見る →」(`8105:1159` / `8105:1292`) で送り出す作りなので、
 * **本ページはその送り先 = 全件一覧**として組む。
 *
 * したがって
 * - カードの寸法・色・字送りの正本 = `8105:1125` / `8105:1262`
 *   (実装は共有部品 `components/karte/tasting-notes.tsx`。お茶カルテ側が
 *   後から同じ部品を 4 件に絞って埋め込める形にしてある)
 * - ページの外枠 (Breadcrumb → ListPageHead → 本体 → 静かな導線) の正本 =
 *   同じ R2 世代で凍結済みの共通リストパターン
 *   (お茶メニュー一覧 `8063:2144` / `8063:2372`) と、お茶カルテ R2 の
 *   PageTitle `8105:1120` / `8105:1251` + 茶葉導線 `8105:1200` / `8105:1330`
 *
 * ## データ
 *
 * 飲んだ記録のバックエンドはまだ無い (新規サーバ実装はしない方針)。実データ源が
 * できるまでは `PREVIEW_SEED=1` の見本でのみ一覧が出て、既定では
 * 「まだ記録がありません」の 1 行になる (データが無い節は枠ごと出さない)。
 *
 * @see docs/fidelity/c13-1-fidelity.md 忠実度対比表 (PC / SP)
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tastingNoteR2");
  return { title: t("title"), description: t("lead") };
}

export default async function TastingNotePage() {
  const t = await getTranslations("tastingNoteR2");
  const bt = await getTranslations("breadcrumb");

  const seeded = seedTastingNotes();
  const records: TastingNoteRecord[] = (seeded ?? []).map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    note: row.note,
    mood: row.mood,
    image: { src: row.imageUrl, alt: row.title },
  }));

  const moodLabels = {
    again: t("moodAgain"),
    matched: t("moodMatched"),
    logged: t("moodLogged"),
  } as const;

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb
        items={[{ label: bt("home"), href: "/" }, { label: t("title") }]}
      />

      <ListPageHead
        overline="TASTING NOTES"
        title={t("title")}
        lead={t("lead")}
      />

      {records.length > 0 ? (
        /* 読み枠は R2 の TastingNotes ブロック幅 896 に合わせる (`max-w-224`)。
           お茶カルテ R2 は Main 1440 を TastingNotes 896 + Sidebar 384 に割って
           いて、カード自体は 896。単独ページでサイドバーが無いからといって
           コンテンツ幅 1312 まで伸ばすと、ひとこと 1 行に対して本文カラムが
           1016 になりカードの体裁が R2 から外れる。見出し (PageTitle) 側は
           R2 でも全幅 1312 なので、そちらは伸ばしたままにする。 */
        <TastingNoteList
          className="mt-8 max-w-224 lg:mt-12"
          records={records}
          moodLabels={moodLabels}
        />
      ) : (
        <p className={cn(bodySmClass, "mt-8 text-muted-foreground lg:mt-12")}>
          {t("empty")}
        </p>
      )}

      {/* 茶葉導線 (R2 8105:1200 / 8105:1330) — 中央寄せの静かな 1 本。
          SP はタップ域 48 を確保する (R2 SP の link 枠 8105:1331 が h48)。 */}
      <div
        data-slot="tasting-note-outro"
        className="mt-10 flex justify-center lg:mt-20"
      >
        <Link
          href="/tea-menu"
          className={cn(
            bodyClass,
            "flex min-h-12 items-center text-foreground hover:opacity-70 lg:min-h-0",
          )}
        >
          {t("outroLink")}
        </Link>
      </div>
    </Section>
  );
}
