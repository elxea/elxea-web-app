import type { PortableTextBlock } from "@portabletext/types";

/**
 * PortableText / 文字列のどちらでも来るフィールドを素のテキストにする。
 *
 * Sanity の schema が `type: "text"` (文字列) でも、既存ドキュメントには
 * blockContent (PortableText の配列) が入っていることがある。カード見出しや
 * リード文にそのまま渡すと React が「Objects are not valid as a React child」
 * (React error #31) で落ちるため、表示側は必ずこれを通す。
 */
export function toPlainText(
  value: PortableTextBlock[] | string | null | undefined
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((block) => {
      if (block._type !== "block" || !Array.isArray(block.children)) return "";
      return (block.children as Array<{ text?: string }>)
        .map((child) => child.text || "")
        .join("");
    })
    .join("\n")
    .trim();
}
