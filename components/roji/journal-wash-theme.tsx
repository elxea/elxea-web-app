"use client";

import { useEffect } from "react";

import { asJournalTheme } from "@/lib/roji/theme-palette";
import { setWashTheme } from "@/lib/roji/wash-theme-store";

/**
 * 開いている記事の号のテーマ色を背景の面へ伝える。描画は持たない。
 *
 * 記事ページ (server component) がこれを 1 つ描くだけで、ルートグループの
 * layout にある `ReadingWash` の色がその号の色に変わる。なぜ context ではなく
 * ストア経由なのかは `lib/roji/wash-theme-store.ts` を参照。
 *
 * 未知のテーマ名は「テーマ無し」に倒れ、季節の色のままになる。号のテーマが
 * 増えたときに背景が消えるより、季節の色で出ている方が安全なため。
 */
export function JournalWashTheme({ theme }: { theme?: string | null }) {
  const resolved = asJournalTheme(theme);

  useEffect(() => setWashTheme(resolved), [resolved]);

  return null;
}

export default JournalWashTheme;
