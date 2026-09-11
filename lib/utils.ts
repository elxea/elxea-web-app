import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 金額表記は `lib/format-price.ts` が唯一の実装。ここは既存の import パス
 * (`@/lib/utils` から読んでいる画面・テスト) を壊さないための再輸出。
 * メール文面は `lib/format-price` を直接読む (UI 用の依存を持ち込まないため)。
 */
export { formatPrice } from "./format-price";
