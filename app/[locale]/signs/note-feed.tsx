"use client";

import * as React from "react";

import { NoteCard } from "@/components/community/note-card";

/**
 * みんなの一言のリスト (Figma 7838:38331 / SP 7839:533)。
 *
 * リアクションは「押せる」ことが設計の要 (選択式のみ・返信なし) なので、
 * 表示専用の disabled チップにはしない。投稿 API がまだ無いため状態は
 * クライアント内に閉じており、リロードで消える。配線時にこの useState を
 * サーバーアクション + 楽観更新に差し替える。
 */
export type SignsNote = {
  id: string;
  voice: string;
  tea: string;
  time: string;
};

export type SignsReactionLabels = {
  wakaru: string;
  iina: string;
  kininaru: string;
};

export function NoteFeed({
  notes,
  labels,
}: {
  notes: SignsNote[];
  labels: SignsReactionLabels;
}) {
  // key = `${noteId}:${reactionId}`
  const [pressed, setPressed] = React.useState<Record<string, boolean>>({});

  const toggle = (noteId: string, reactionId: string) =>
    setPressed((prev) => {
      const key = `${noteId}:${reactionId}`;
      return { ...prev, [key]: !prev[key] };
    });

  return (
    <div className="flex flex-col gap-4">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          voice={note.voice}
          tea={note.tea}
          time={note.time}
          reactions={[
            { id: "wakaru", label: labels.wakaru },
            { id: "iina", label: labels.iina },
            { id: "kininaru", label: labels.kininaru },
          ].map((reaction) => ({
            ...reaction,
            pressed: Boolean(pressed[`${note.id}:${reaction.id}`]),
          }))}
          onSelectReaction={(reactionId) => toggle(note.id, reactionId)}
        />
      ))}
    </div>
  );
}
