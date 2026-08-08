/**
 * 記事・プレイリストの日付表記 — `YYYY.MM.DD` に統一する (C4-2R / 2026-08-08).
 *
 * Figma 確定版はジャーナル系の日付をすべて「2026.08.05」= ドット区切り・
 * ゼロ埋め 4-2-2 で書いている (例: カテゴリ索引 PC 8083:4084「最終更新
 * 2026.08.05」/ SP 8083:4227)。`toLocaleDateString(locale)` はロケールで
 * 区切りと桁数が変わり (ja-JP → `2026/1/31` / en → `1/31/2026`) Figma と
 * 一致しないので、コンテンツ日付には使わない。
 *
 * 設計判断:
 * - **ロケール非依存**。表記そのものがデザインの確定値なので ja / en で
 *   揃える (ロケールで揺れさせない)。
 * - **タイムゾーンを Asia/Tokyo に固定**。Sanity の datetime は UTC (`…Z`)
 *   で入るため、実行環境の TZ (Vercel は UTC) で組むと JST 夜に公開した記事が
 *   1 日前に見える。編集側は JST で日付を決めているので JST で描く。
 *   サーバ / クライアントどちらで描いても同じ文字列になるため hydration も安定する。
 *
 * 取引系の日付 (注文・定期便・イベント) はここを使わない。あちらは
 * ロケール依存の長い表記を意図して使っている。
 */
const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * `YYYY.MM.DD` を返す。値が無い / 日付として読めない場合は空文字を返すので、
 * 呼び側は `formatArticleDate(x) || null` のように落とせる。
 */
export function formatArticleDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = FORMATTER.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (!year || !month || !day) return "";

  return `${year}.${month}.${day}`;
}
