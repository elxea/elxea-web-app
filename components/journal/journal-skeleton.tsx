import { Section } from "@/components/layout/container";
import { ImageCard } from "@/components/media/image-card";
import { SkeletonBar } from "@/components/ui/skeleton-bar";
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

/**
 * ArticleCardSkeleton — Figma `ArticleCardSkeleton (Module)` 8173:254。
 *
 * ArticleCard (5483:15) と同じ寸法にして、読込完了時のレイアウトシフトを
 * 起こさないことが目的。矩形はすべて SkeletonBar (Figma 8179:347) で、
 * 手描きの矩形も金色の accent も使わない。
 *
 * Figma 実測 (394 幅カード) → 実装:
 * - 写真 → 情報の gap 16      → `gap-4`
 * - 写真 aspect 3/2 (394x263) → `ImageCard` (既定 3/2) + 面は mode/muted
 * - 情報 5 行 / 行間 8        → `gap-2`
 *   14x96 / 18x394 (全幅) / 14x394 (全幅) / 14x280 / 12x160
 *   → h-3.5 w-24 / h-4.5 w-full / h-3.5 w-full / h-3.5 w-[71%] / h-3 w-2/5
 */
export function ArticleCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="article-card-skeleton"
      aria-hidden="true"
      className={cn("flex flex-col gap-4", className)}
    >
      {/* ImageCard の既定面は muted。placeholder として空のまま置く。 */}
      <ImageCard className="animate-pulse" />
      <div className="flex flex-col gap-2">
        <SkeletonBar className="h-3.5 w-24" />
        <SkeletonBar className="h-4.5 w-full" />
        <SkeletonBar className="h-3.5 w-full" />
        <SkeletonBar className="h-3.5 w-[71%]" />
        <SkeletonBar className="h-3 w-2/5" />
      </div>
    </div>
  );
}

/**
 * 一覧グリッドの骨組み。Figma の注記「表示は 6 枚を上限とし、それ以上は出さない」
 * に従う (待ち時間の見た目を実際の件数より豪華にしない)。
 */
export function JournalGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <JournalGrid className={className} aria-hidden="true">
      {Array.from({ length: Math.min(count, 6) }).map((_, i) => (
        <ArticleCardSkeleton key={i} />
      ))}
    </JournalGrid>
  );
}

/** 見出し (キッカー + タイトル + リード) の骨組み。 */
function PageHeadSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden="true">
      <SkeletonBar className="h-3 w-24" />
      <SkeletonBar className="h-10 w-2/3" />
      <SkeletonBar className="h-3 w-full max-w-160" />
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
      <SkeletonBar className="h-3 w-20" />
      <div className="mt-2 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBar key={i} className="h-4 w-full" />
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
        <SkeletonBar className="h-3 w-48" />
        <div className="mt-6 space-y-4" aria-hidden="true">
          <SkeletonBar className="h-3 w-20" />
          <SkeletonBar className="h-10 w-full" />
          <SkeletonBar className="h-4 w-40" />
        </div>
        <div className="mt-6 -mx-4 lg:-mx-10" aria-hidden="true">
          <ImageCard
            className="[--bleed-ar:3/2] lg:[--bleed-ar:5/3] rounded-none lg:rounded-md"
            style={{ aspectRatio: "var(--bleed-ar)" }}
          />
        </div>
        <div className="mt-6 space-y-3" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBar key={i} className={cn("h-4", i % 4 === 3 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      </div>
    </Section>
  );
}
