/**
 * 季節と時刻から「にじみ」の色を作る純関数。
 *
 * roji の情動レイヤー (系統1: 全顧客共通データ) の実装。カルテには一切触れず、
 * **月と時間帯だけ** で色が決まる。個人データが要らないので先行して実装できる、
 * という切り分けが系統1の定義そのもの。
 * 正本: Planning｜roji眺めの面コンセプト
 * https://www.notion.so/3b970c9d064c816da7b3c0bf2c15557f (「実現方式とデータ接続」節)
 *
 * ## 出さないもの (コンセプト第3節「5則」より)
 * 季節名・時間帯名・数値・凡例は **返り値に含めない**。この関数が返すのは色だけで、
 * 色に名前を付けないことが「あなたは◯◯です」を構造的に発生させない担保になる。
 * 下のコメント内の和名は実装者向けの覚え書きであり、UI には一切出さない。
 *
 * ## なぜ値がここ (コード) にあり tokens/base.json に無いか
 * デザイントークンの正本は Figma (CLAUDE.md「Design Tokenアーキテクチャ」)。
 * ただしこの 48 通り (12ヶ月 x 4時間帯) は **UI の色ではなく生成表現の入力** であり、
 * Figma 側の静止画合意 (コンセプト第6節の段②) はまだ行われていない。段② が済んで
 * 「季節ごとの地の色」が Figma 変数になった時点で、ここは Figma の写しに置き換える。
 * それまでは v0 のプレビュー専用値として扱い、本番の画面からは参照しない。
 *
 * 彩度は既存トークンの帯域 (C = 0.006〜0.061、brand-gold 0.173 のみ例外) に収める。
 * ここを外すと既存 UI と喧嘩する。テストで機械的に検査している。
 */

import { mixHue, oklchToHex, type Oklch } from "./color";

export type TimeOfDay = "morning" | "day" | "dusk" | "night";

export const TIMES_OF_DAY: readonly TimeOfDay[] = [
  "morning",
  "day",
  "dusk",
  "night",
] as const;

/** 4 色ちょうど。にじみの塊はこの色を巡回して使う。 */
export type SeasonalPalette = [string, string, string, string];

type OklchQuad = [Oklch, Oklch, Oklch, Oklch];

const o = (l: number, c: number, h: number): Oklch => ({ l, c, h });

/**
 * 月ごとの地の色 (昼を基準とした 4 色)。
 *
 * 8 月末リリース想定のため晩夏 (8) 〜 秋 (9-11) を厚めに作り分けている。
 * 和名は実装メモ。画面には出さない。
 */
const MONTHLY_BASE: Record<number, OklchQuad> = {
  // 1月 — 雪明かりと薄墨。いちばん彩度が低い月。
  1: [o(0.945, 0.006, 232), o(0.858, 0.018, 250), o(0.93, 0.012, 96), o(0.775, 0.01, 268)],
  // 2月 — 生成りに薄紅梅がひとつ混じる。
  2: [o(0.935, 0.01, 94), o(0.888, 0.028, 16), o(0.868, 0.014, 242), o(0.902, 0.02, 158)],
  // 3月 — 霞。輪郭がいちばん緩む月。
  3: [o(0.945, 0.008, 82), o(0.902, 0.03, 12), o(0.888, 0.028, 140), o(0.834, 0.01, 100)],
  // 4月 — 桜と若葉。
  4: [o(0.906, 0.034, 8), o(0.882, 0.042, 145), o(0.94, 0.012, 96), o(0.916, 0.038, 95)],
  // 5月 — 新緑。年間でいちばん緑に寄る。
  5: [o(0.862, 0.055, 145), o(0.896, 0.043, 130), o(0.94, 0.01, 96), o(0.9, 0.026, 230)],
  // 6月 — 梅雨。水浅葱と苔。
  6: [o(0.882, 0.034, 195), o(0.806, 0.038, 155), o(0.862, 0.01, 240), o(0.93, 0.01, 96)],
  // 7月 — 盛夏。水と光。
  7: [o(0.906, 0.038, 215), o(0.886, 0.042, 190), o(0.95, 0.006, 96), o(0.856, 0.036, 175)],
  // 8月 — 晩夏。淡い水色 x 薄緑 x 生成り、そこに夕方へ向かう白藤の影。
  8: [o(0.901, 0.036, 222), o(0.886, 0.038, 162), o(0.938, 0.013, 95), o(0.866, 0.022, 265)],
  // 9月 — 初秋。薄柿と芒、秋の空。
  9: [o(0.845, 0.052, 48), o(0.886, 0.028, 85), o(0.935, 0.012, 96), o(0.856, 0.014, 235)],
  // 10月 — 秋。薄柿色 x 金茶 x 薄墨。
  10: [o(0.822, 0.058, 42), o(0.812, 0.062, 70), o(0.925, 0.014, 92), o(0.758, 0.012, 255)],
  // 11月 — 晩秋。枯野。彩度が落ちながら暖色が残る。
  11: [o(0.782, 0.046, 58), o(0.822, 0.038, 78), o(0.902, 0.018, 88), o(0.792, 0.008, 250)],
  // 12月 — 初冬。白練に柿の名残。
  12: [o(0.945, 0.008, 92), o(0.832, 0.02, 205), o(0.802, 0.008, 265), o(0.848, 0.028, 50)],
};

interface TimeShift {
  /** 明度の移動量。その月の平均明度を基準に上下する。夜がいちばん深い。 */
  deltaL: number;
  /**
   * 明度差の倍率。1 なら月の色の明暗差をそのまま保つ。
   *
   * 夜を「全部を同じだけ暗くする」で作ると、4 色が中明度に固まって
   * **一様な灰色の霞** になる (実測: 8月夜が灰緑一色になった)。暗くするときは
   * 同時に明暗差を開いて、月明かりの側と沈む側を作る。
   */
  contrast: number;
  /** 彩度の倍率。朝は澄み、夕は濃く、夜は少しだけ褪せる。 */
  chromaScale: number;
  /** 寄せ先の色相。`towardAmount` = 0 のときは使わない。 */
  towardHue: number;
  /** 寄せる量 (0-1)。 */
  towardAmount: number;
}

/**
 * 時間帯の効き方。
 *
 * 色相は「固定量だけ回す」のではなく **アンカー色相へ寄せる**。固定回転だと
 * 暖色と寒色で意味が逆になり、季節ごとに破綻するため (`mixHue` のコメント参照)。
 */
const TIME_SHIFT: Record<TimeOfDay, TimeShift> = {
  // 朝 — わずかに明るく、明暗差は締めて、澄む。
  morning: {
    deltaL: 0.018,
    contrast: 0.95,
    chromaScale: 0.92,
    towardHue: 100,
    towardAmount: 0.1,
  },
  // 昼 — 基準。月の色そのまま。
  day: { deltaL: 0, contrast: 1, chromaScale: 1, towardHue: 0, towardAmount: 0 },
  // 夕 — 沈みながら温度が上がり、影が出る。
  dusk: {
    deltaL: -0.05,
    contrast: 1.35,
    chromaScale: 1.25,
    towardHue: 40,
    towardAmount: 0.22,
  },
  // 夜 — 深く沈み、藍へ寄る。彩度は落としすぎない (落とすと「静けさ」ではなく
  // 「くすみ」になる)。明暗差を大きく開くのがこの時間帯の要。
  night: {
    deltaL: -0.3,
    contrast: 2.2,
    chromaScale: 0.85,
    towardHue: 265,
    towardAmount: 0.28,
  },
};

/** 生成色の明度域。下限は「暗い」ではなく「静か」に留めるための床。 */
const MIN_LIGHTNESS = 0.42;
const MAX_LIGHTNESS = 0.97;

/** 明暗差を開閉する基準点 = その月の 4 色の平均明度。 */
function meanLightness(quad: OklchQuad): number {
  return quad.reduce((sum, color) => sum + color.l, 0) / quad.length;
}

function applyTimeShift(base: Oklch, shift: TimeShift, pivot: number): Oklch {
  const l = pivot + shift.deltaL + (base.l - pivot) * shift.contrast;
  return {
    l: Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l)),
    c: base.c * shift.chromaScale,
    h:
      shift.towardAmount === 0
        ? base.h
        : mixHue(base.h, shift.towardHue, shift.towardAmount),
  };
}

/** 1-12 に丸める (13 -> 1、0 -> 12)。Date 由来でない外部入力を受けるため。 */
export function normalizeMonth(month: number): number {
  const rounded = Math.round(month);
  return ((rounded - 1) % 12 + 12) % 12 + 1;
}

/**
 * 時刻 (0-23) -> 時間帯。
 *
 * 境界は日本の生活時間に寄せた: 朝 5-9 / 昼 10-15 / 夕 16-18 / 夜 19-4。
 * 二十四節気のような精度は v0 では要らない (コンセプト第5節「入力は驚くほど少なくてよい」)。
 */
export function timeOfDayFromHour(hour: number): TimeOfDay {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 16) return "day";
  if (h >= 16 && h < 19) return "dusk";
  return "night";
}

/** 月 + 時間帯 -> 4 色。純関数。 */
export function seasonalPaletteFor(
  month: number,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  const base = MONTHLY_BASE[normalizeMonth(month)];
  const shift = TIME_SHIFT[timeOfDay];
  const pivot = meanLightness(base);
  const [a, b, c, d] = base.map((color) =>
    oklchToHex(applyTimeShift(color, shift, pivot)),
  );
  return [a, b, c, d];
}

/** その日時の景色の色。端末のローカル時刻をそのまま使う。 */
export function seasonalPalette(date: Date = new Date()): SeasonalPalette {
  return seasonalPaletteFor(
    date.getMonth() + 1,
    timeOfDayFromHour(date.getHours()),
  );
}

/**
 * 月のリズム -> tempo (0.5-2)。
 *
 * コンセプト「実現方式とデータ接続」の系統1: 月初は動き、月末は静けさ。
 * 幅は控えめ (0.75-1.15) に取る。眺めは遅いほど roji らしいため、
 * 速い側へは振らない。
 */
export function seasonalTempo(date: Date = new Date()): number {
  const day = date.getDate();
  const daysInMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  const progress = (day - 1) / Math.max(1, daysInMonth - 1);
  return 1.15 - 0.4 * progress;
}
