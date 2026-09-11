/**
 * 内容量 (netWeight) の表示整形 — 単位「g」を **1 回だけ** 付ける (C9-1R / 2026-08-09).
 *
 * ## なぜ共通化が必要か
 * Sanity の `teaMenu.netWeight` は schema 上 `type: "number"` (タイトルは
 * 「内容量（g）」= 単位はスキーマ側が持つ前提) だが、**実データには文字列
 * `"50g"` が入っている**。Sanity の Content Lake は schema を実行時に強制
 * しないため、投入側 (`scripts/seed-dummy-content.ts` が `netWeight: "50g"`)
 * の値がそのまま残っている。
 *
 * 表示側が `` `${tea.netWeight}g` `` と書くと:
 * - 数値 `50`      → `50g`   (期待どおり)
 * - 文字列 `"50g"` → `50gg` (**二重単位**。C9-1 の QA 指摘)
 *
 * よって「片方だけを前提にしない」正規化をここに集約し、内容量を出す画面は
 * すべてこの関数を通す (お茶メニュー詳細のスペック帯 / elxea Journal の
 * TeaSpecCard)。表示側で個別に単位を足すことは禁止。
 *
 * ## 判定規則
 * 1. `null` / `undefined` / 空文字 (空白のみも含む) → `undefined`
 *    (呼び出し側の「値が無い行は落とす」判定にそのまま乗る)
 * 2. `number` → 有限値なら `<n>g`。`NaN` / `Infinity` は `undefined`
 * 3. `string` で **数値だけ** (`50` / `50.5` / 全角 `５０`) → `<n>g`
 * 4. それ以外の `string` (`50g` / `2g × 10袋` / `約50グラム`) → trim して
 *    **そのまま返す**。単位や補足はすでに編集側が書いているので足さない
 *
 * 3 の全角数字は Sanity Studio で全角入力されたケースの保険。半角に寄せてから
 * 単位を足す (`５０` → `50g`)。
 */

/** 内容量フィールドが取り得る型 (数値でも文字列でも来る)。 */
export type NetWeightValue = string | number | null | undefined;

const UNIT = "g";

/** 全角数字・全角ピリオドを半角へ。 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".");
}

/** 数値だけで構成された文字列か (符号や単位は不可)。 */
function isNumericOnly(input: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(input);
}

/**
 * 内容量を表示用文字列にする。値が無いときは `undefined` を返す
 * (「データが無い行は出さない」方針に合わせるため空文字ではない)。
 */
export function formatNetWeight(value: NetWeightValue): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    return Number.isFinite(value) ? `${value}${UNIT}` : undefined;
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const halfWidth = toHalfWidth(trimmed);
  if (isNumericOnly(halfWidth)) return `${Number(halfWidth)}${UNIT}`;

  // すでに単位や補足が入っている (`50g` / `2g × 10袋` / `約50グラム`)。
  return trimmed;
}
