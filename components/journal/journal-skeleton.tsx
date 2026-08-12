import { Section } from "@/components/layout/container";
import { ImageCard } from "@/components/media/image-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { JournalGrid, JournalLayout } from "./journal-list";

/**
 * ジャーナルのローディング表現 (A7)。
 *
 * これまでジャーナル一覧の `Suspense` の中にだけ骨組みがあり、記事詳細・
 * カテゴリ・タグ・著者には `loading.tsx` が無かった。サーバ側の fetch が
 * 終わるまで前のページが出たままになり、遅い回線では「押しても何も起きない」
 * ように見えていた。ここに置いた部品を各ルートの `loading.tsx` が使う。
 *
 * 形は実ページの骨格 (グリッド 2 列・サイドバー・本文カラム 640) に合わせる。
 * レイアウトが入れ替わらないので、読み込み完了時に画面が飛ばない。
 */

/** 一覧グリッドの骨組み。Figma の 2 列 x 3 段 = 6 枚に合わせる。 */
export function JournalGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <JournalGrid className={className} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-4">
          <ImageCard />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </JournalGrid>
  );
}

/** 見出し (キッカー + タイトル + リード) の骨組み。 */
function PageHeadSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-3 w-full max-w-160" />
    </div>
  );
}

/** サイドバー (人気の記事 / カテゴリ) の骨組み。 */
function RailSkeleton() {
  return (
    <aside
      className="order-3 mt-8 animate-pulse px-4 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:w-86"
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-20" />
      <div className="mt-2 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </aside>
  );
}

/**
 * 一覧系ページ (カテゴリ / タグ / 著者) 共通のローディング画面。
 *
 * `status` + `aria-live` を付けて、支援技術にも「読み込み中」であることを
 * 伝える (見た目のスケルトンだけにしない)。
 */
export function JournalListPageSkeleton({
  loadingLabel,
  withRail = true,
  className,
}: {
  loadingLabel: string;
  withRail?: boolean;
  className?: string;
}) {
  return (
    <Section spacing="none" className={cn("pt-6 pb-16 lg:pb-28", className)}>
      <span role="status" aria-live="polite" className="sr-only">
        {loadingLabel}
      </span>
      <PageHeadSkeleton />
      <JournalLayout className="mt-8 lg:mt-12">
        <JournalGridSkeleton />
        {withRail ? <RailSkeleton /> : null}
      </JournalLayout>
    </Section>
  );
}

/**
 * 記事詳細のローディング画面。本文カラム 640 (`max-w-160`) と
 * 冒頭写真の裁ち落とし (`-mx-4 lg:-mx-10`) を実ページと揃える。
 */
export function ArticlePageSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <div className="mx-auto w-full max-w-160 animate-pulse">
        <span role="status" aria-live="polite" className="sr-only">
          {loadingLabel}
        </span>
        <Skeleton className="h-3 w-48" aria-hidden="true" />
        <div className="mt-6 space-y-4" aria-hidden="true">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mt-6 -mx-4 lg:-mx-10" aria-hidden="true">
          <ImageCard
            className="[--bleed-ar:3/2] lg:[--bleed-ar:5/3] rounded-none lg:rounded-md"
            style={{ aspectRatio: "var(--bleed-ar)" }}
          />
        </div>
        <div className="mt-6 space-y-3" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-4", i % 4 === 3 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      </div>
    </Section>
  );
}
