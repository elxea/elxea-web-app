import { cn } from "@/lib/utils"

/**
 * Skeleton — 読み込み中の場所取り。
 *
 * 面は `muted` (中立のグレー) を使う。shadcn の既定は `accent` だが、elxea の
 * accent は金 (`--color-accent` = oklch chroma 0.173 / hue 85.6) なので、
 * 既定のままだと「まだ何も無い箇所」がサイト内で最も強い色で光ってしまい、
 * 一覧・記事・商品どのページでも読み込みのたびに金色の板が並ぶ。
 * 場所取りは内容ではないので、目を引かない中立面が正しい。
 *
 * accent (金) は「選ばれている / 押せる」を表す色として、hover・focus・選択中
 * などの状態にだけ残す (bg-accent の他の利用箇所はすべてそれに当たるため触らない)。
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
