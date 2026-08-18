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

/**
 * イベントの開催日時 — Figma【R2: 確定版】イベント詳細 6658:13327 / 6663:8175 の
 * 「2026年8月10日（日）14:00–17:00」形式。
 *
 * 上の `formatArticleDate` と方針が違う点:
 * - **ロケール依存**。取引系 (注文・定期便・イベント) は意図してロケールの長い
 *   表記を使う (このファイル冒頭の但し書きどおり)。曜日も Figma に載っている。
 * - **タイムゾーンは Asia/Tokyo に固定**。Sanity の datetime は UTC で入り、
 *   実行環境の TZ (Vercel は UTC) で組むと JST 夜のイベントが 1 日前に見える。
 *   サーバ / クライアントどちらで描いても同じ文字列になるので hydration も安定する。
 *   (旧実装は `toLocaleDateString(locale)` を TZ 指定なしで呼んでいたためズレた)
 *
 * 出力規則:
 * - 時刻が 00:00 (JST) の値は「時刻の入力なし」とみなして日付だけを出す
 * - 終了日時が同じ日 → `日付 開始–終了` (Figma と同じ en dash)
 * - 終了日時が別の日 → `開始日付 開始時刻 – 終了日付 終了時刻`
 * - 読めない値は空文字を返すので、呼び側は節ごと落とせる
 */
const EVENT_TZ = "Asia/Tokyo";

function eventDayFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: EVENT_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function eventTimeFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: EVENT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** JST での `YYYY-MM-DD` (同日判定用)。 */
function jstDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** JST の時刻が 00:00 かどうか (= 時刻未入力とみなす)。 */
function isMidnightJst(date: Date): boolean {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date) === "00:00"
  );
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEventSchedule(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
  locale: string,
): string {
  const startDate = toDate(start);
  if (!startDate) return "";

  const day = eventDayFormatter(locale);
  const time = eventTimeFormatter(locale);
  const startDay = day.format(startDate);
  const startHasTime = !isMidnightJst(startDate);
  const startTime = startHasTime ? time.format(startDate) : "";

  const endDate = toDate(end);
  if (!endDate) {
    return startHasTime ? `${startDay} ${startTime}` : startDay;
  }

  const sameDay = jstDayKey(startDate) === jstDayKey(endDate);
  const endHasTime = !isMidnightJst(endDate);
  const endTime = endHasTime ? time.format(endDate) : "";

  if (sameDay) {
    if (startHasTime && endHasTime) return `${startDay} ${startTime}–${endTime}`;
    return startHasTime ? `${startDay} ${startTime}` : startDay;
  }

  const left = startHasTime ? `${startDay} ${startTime}` : startDay;
  const right = endHasTime ? `${day.format(endDate)} ${endTime}` : day.format(endDate);
  return `${left} – ${right}`;
}

/**
 * 開始と終了が JST で**同じ日**か。値が読めない / 終了が無いときは `false`。
 *
 * 一覧カードのように「日付だけ」を出す面で、終了日を無条件に併記すると同日開催の
 * イベントが「2026年8月10日 — 2026年8月10日」と同じ日付を 2 回描いてしまう。
 * 日付だけを出す呼び側は、終了日の併記をこの判定で落とす
 * (時刻レンジまで出す面は `formatEventSchedule` を使う)。
 */
export function isSameEventDay(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
): boolean {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return false;
  return jstDayKey(startDate) === jstDayKey(endDate);
}

/**
 * 開催が JST で**今日より前に終わっている**か (= 一覧に出さないイベント)。
 *
 * 判定は「日」単位で行い、時刻では切らない。当日の朝に開催が終わるイベントでも
 * その日いっぱいは一覧に残す方が、来場者の「今日これだったよね」に応える。
 * 複数日開催は `endDate` を見るので、会期中のイベントは初日を過ぎても落ちない。
 *
 * 日付が読めない値では **false** を返す (隠す側に倒さない)。表示ロジックの
 * フィルタが、壊れた 1 件を理由に正しいイベントまで消すことは避ける。
 */
export function isPastEvent(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const last = toDate(end) ?? toDate(start);
  if (!last) return false;
  return jstDayKey(last) < jstDayKey(now);
}
