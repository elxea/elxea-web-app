"use client";

import { Loader2Icon } from "lucide-react";
import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

/**
 * 「さらに N 件を表示」の中身。**押してから一覧が入れ替わるまでの進行**を出す。
 *
 * ## 直している症状 (網羅表 2026-08-27 / G6)
 *
 * この導線は `?show=` を伸ばして**一覧を丸ごと取り直す**。追記ではないので、
 * 押してからサーバの往復が着地するまで画面は 1 ドットも変わらない。押した人
 * から見れば「反応が無い」で、二度押し・離脱の原因になる。
 *
 * 一覧の取り直し自体は消せない (件数はサーバが決める) が、**押されたことを
 * 即座に見せる**ことはできる。`useLinkStatus` は Next の遷移が始まった時点で
 * `pending` になるので、自前で `useTransition` を書いて `<Link>` を
 * `<button onClick={router.push}>` に作り替える必要が無い — 素の `<Link>` の
 * まま (= 中クリック・新しいタブで開く・先読みが効いたまま) 進行だけ足せる。
 *
 * **受付は閉じない**。`disabled` にも `pointer-events-none` にもしない
 * (`lib/interaction` の約束と同じ — 遅いことと押せないことは別)。
 */
export function MoreRowProgress({ label }: { label: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      data-slot="more-row-label"
      data-pending={pending ? "true" : undefined}
      aria-busy={pending}
      className={cn("inline-flex items-center gap-2")}
    >
      {pending ? (
        <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      ) : null}
      {label}
    </span>
  );
}
