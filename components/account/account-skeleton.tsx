import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { cn } from "@/lib/utils";

import { AccountCardGrid, AccountGreetingBand, AccountTitleBlock } from "./account-parts";

/**
 * マイページのローディング表現 (監査 #5 / W-B)。
 *
 * `app/[locale]/account/page.tsx` の `<Suspense>` の fallback。サーバが Shopify /
 * Firestore / cx-agent の返事を待っているあいだ、**前のページを出したままにしない**
 * ための骨組み。実測で 2.2〜3.2 秒あった無反応の時間を、待ち時間の短縮ではなく
 * 「どこで待つか」の付け替えで埋める。
 *
 * 主見出しだけは待たずに確定している (ページの名前は取得結果に依存しない) ので、
 * 骨組みではなく実物 (`AccountTitleBlock`) を出す。読み込み完了時に見出しが
 * 差し替わらないぶん、切り替わりが静かになる。
 *
 * 形は実ページの節構成 (TitleBlock → GreetingBand → これから → お気に入り →
 * これまで → お支払い方法) に合わせてあり、カード枠も `AccountCardGrid` を
 * そのまま使う。骨組みと中身で寸法が違うと、届いた瞬間に画面が飛ぶ。
 */
export function AccountPageSkeleton({
  title,
  loadingLabel,
}: {
  title: string;
  /** 支援技術向けの読み上げ文言。見た目には出さない。 */
  loadingLabel: string;
}) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {loadingLabel}
      </span>

      <AccountTitleBlock
        title={title}
        identity={<SkeletonBar className="inline-block h-3 w-56 max-w-full align-middle" />}
      />

      <AccountGreetingBand
        greeting={<SkeletonBar className="inline-block h-8 w-64 max-w-full align-middle" />}
        lead={<SkeletonBar className="inline-block h-3 w-80 max-w-full align-middle" />}
      />

      {/* 3 節ぶんの骨組み。実ページは中身次第で節が落ちるので、待ち時間の見た目を
          実際より豪華にしないよう最小限 (2 節 3 枚 + 1 節 2 枚) に留める。 */}
      <SectionSkeleton columns={3} cards={3} />
      <SectionSkeleton columns={2} cards={2} />
      <SectionSkeleton columns={3} cards={3} />
    </>
  );
}

function SectionSkeleton({ columns, cards }: { columns: 2 | 3; cards: number }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="page-container flex items-baseline justify-between gap-4 pt-6 pb-3 lg:pt-10 lg:pb-4"
      >
        <SkeletonBar className="h-4 w-28" />
      </div>
      <AccountCardGrid columns={columns}>
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </AccountCardGrid>
    </>
  );
}

/** `AccountRecordCard` と同じ枠・同じ行数にした骨組み。 */
function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border/40 bg-card px-4 py-4 lg:gap-3 lg:px-6 lg:py-6",
        className
      )}
    >
      <SkeletonBar className="h-3 w-24" />
      <SkeletonBar className="h-4 w-3/4" />
      <SkeletonBar className="h-3 w-1/2" />
    </div>
  );
}
