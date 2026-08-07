import * as React from "react";

import { cn } from "@/lib/utils";

import { ReactionChip } from "./reaction-chip";

/**
 * NoteCard — Figma
 * `NoteCard (Proposed) — elxea/みんなの気配 匿名ノート` 7840:39598。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - symbol 7840:39598 …… 560 x 161、内側 padding 24 (= component.card.padding.md)
 * - voice 7840:39590 …… y=24 h=24
 * - meta  7840:39591 …… y=60 h=20 (voice との間 12 / spacing.3)
 *   - tea 左寄せ / time 右寄せ (x=475 w=37 で右端 512 に接する)
 * - reactions 7840:39594 …… y=92 h=45、チップ間 8 (spacing.2)
 * 高さ 161 = 24 + 24 + 12 + 20 + 12 + 45 + 24 で実測と一致する。
 *
 * 匿名投稿なので著者要素を持たない。リアクションは選択式のみ (自由入力なし) で
 * `ReactionChip` に委譲する。幅は親に従う (560 は Figma のプレビュー幅)。
 */
export type NoteCardReaction = {
  /** リアクションの識別子 (例 "wakaru")。 */
  id: string;
  /** 表示ラベル。 */
  label: string;
  /** 件数。 */
  count?: number;
  /** 閲覧者が選択済みか。 */
  pressed?: boolean;
};

export type NoteCardProps = React.ComponentProps<"article"> & {
  /** 投稿本文 (匿名の一言)。 */
  voice: string;
  /** 飲んでいたお茶の名前。 */
  tea: string;
  /** 投稿時刻の表示文字列 (例「6:40」)。整形は呼び出し側の責務。 */
  time: string;
  /** 選択式リアクション。 */
  reactions?: NoteCardReaction[];
  /** リアクション選択時のハンドラ。未指定ならチップは表示のみ (disabled)。 */
  onSelectReaction?: (id: string) => void;
};

export function NoteCard({
  voice,
  tea,
  time,
  reactions,
  onSelectReaction,
  className,
  ...props
}: NoteCardProps) {
  return (
    <article
      data-slot="note-card"
      className={cn(
        "flex flex-col border border-border bg-background p-(--component-card-padding-md)",
        className,
      )}
      {...props}
    >
      <p className="text-base leading-6 text-foreground">{voice}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{tea}</span>
        <span className="tabular-nums">{time}</span>
      </div>
      {reactions && reactions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {reactions.map((reaction) => (
            <ReactionChip
              key={reaction.id}
              label={reaction.label}
              count={reaction.count}
              pressed={reaction.pressed}
              disabled={!onSelectReaction}
              onClick={
                onSelectReaction
                  ? () => onSelectReaction(reaction.id)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </article>
  );
}
