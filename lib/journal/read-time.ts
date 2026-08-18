import type { PortableTextBlock } from "@portabletext/types";

import { toPlainText } from "@/lib/sanity-text";

/**
 * 読了目安 — 記事本文から「n 分で読める」の n を出す。
 *
 * 日本語と英語では 1 分に読める量の単位が違う (字 / 語) ので、同じ本文でも
 * 混在する。片方の基準だけで割ると、英語記事は実際の 3〜5 倍の分数が出て
 * 目安として使えなくなるため、2 つに分けて数えてから足す。
 *
 * - 日本語 (漢字・かな・全角): 550 字/分。一般的な目安 500〜600 字/分の中央を取る
 * - それ以外 (英数字の語): 220 語/分
 *
 * どちらも「ざっと読む」ではなく「普通に読む」速さ。目安なので端数は切り上げ、
 * 本文があるかぎり最低 1 分を返す (「0 分で読める」は意味を成さないため)。
 * 本文が空なら null を返し、呼び出し側は表示ごと出さない。
 */

/** 1 分に読める日本語の字数。 */
const JA_CHARS_PER_MINUTE = 550;

/** 1 分に読める英語の語数。 */
const EN_WORDS_PER_MINUTE = 220;

/**
 * 日本語として数える文字。漢字 / ひらがな / カタカナ / 全角句読点・記号。
 * ラテン文字と数字は語として数えたいのでここには入れない。
 */
const JA_CHAR_PATTERN =
  /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-ﾟ]/g;

export function countReadingUnits(text: string): {
  jaChars: number;
  enWords: number;
} {
  const jaChars = text.match(JA_CHAR_PATTERN)?.length ?? 0;

  // 日本語文字を取り除いた残りを語として数える。日本語の間に挟まった英単語も
  // ここで拾える (「〜を Sanity で〜」の Sanity など)。
  const enWords = text
    .replace(JA_CHAR_PATTERN, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

  return { jaChars, enWords };
}

/**
 * 本文 (PortableText or 文字列) から読了目安の分数を返す。本文が空なら null。
 */
export function readingMinutes(
  body: PortableTextBlock[] | string | null | undefined
): number | null {
  const text = toPlainText(body);
  if (!text.trim()) return null;

  const { jaChars, enWords } = countReadingUnits(text);
  if (jaChars === 0 && enWords === 0) return null;

  const minutes = jaChars / JA_CHARS_PER_MINUTE + enWords / EN_WORDS_PER_MINUTE;
  return Math.max(1, Math.ceil(minutes));
}
