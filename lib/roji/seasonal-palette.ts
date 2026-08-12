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
 * ## 彩度の帯域 (v1 で引き上げ)
 * v0 は既存トークンの彩度域 (C = 0.006〜0.061) にそのまま収めていたが、それは
 * **文字や罫線の色** の帯域であって、面の帯域ではなかった。結果として色が地の
 * オフホワイトと区別できず、夜は無彩色に潰れた。v1 は上限を 0.13 (brand-gold
 * 0.173 より下) まで開ける。ただし **全色を一律に上げるのではない**: 地の彩度は
 * むしろ下げ (紙は紙のまま)、主役だけを上げて **色どうしの差** を作る。
 * 面の存在感は平均彩度ではなく色間コントラストで出す、というのが v1 の方針。
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

/**
 * 面のもとになる 4 色 (時間帯の効果を掛ける **前** の値)。
 *
 * 月の色 (`MONTHLY_BASE`) だけでなく、elxea journal の号のテーマ色から作った
 * 4 色もここへ入る (`lib/roji/theme-palette.ts`)。時間帯の効かせ方
 * (`TIME_SHAPE`) と彩度・明度の帯はどちらも同じものを通す必要があるので、
 * 型と整形 (`shapePalette`) を公開して経路を 1 本に保つ。
 */
export type OklchQuad = [Oklch, Oklch, Oklch, Oklch];

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

/**
 * 4 色それぞれが面の中で果たす役割。
 *
 * v0 は 4 色を **一律に** 変換していた (全部を同じだけ暗くし、全部の彩度に同じ倍率を
 * 掛ける)。その結果いちばん壊れたのが夜で、明度が中央に寄り彩度が一様に下がるので
 * 面全体が無彩色に潰れた (実測: 12月夜がほぼグレー、8月夜が濁った青灰)。
 *
 * v1 は「暗い = 灰色」を切り離す。色を役割に分けて **別々の式** を当てる:
 * - `ground` — 地。夜は深い藍・墨、朝昼は生成りの紙。面積がいちばん広い
 * - `accent` — 主役。夜は行灯の **灯り** (暖色・明度を落とさず彩度を上げる)、
 *   朝昼はいちばん色のある一色
 * - `mid` — 残り。地と主役をつなぐ中間層
 *
 * 夜に彩度を **上げる** のがこの設計の要。OKLCH の C は明度と独立なので、L を
 * 0.25 まで落としても C を 0.05〜0.09 に保てば「深い藍」であって「暗いグレー」には
 * ならない。逆に C を 0.03 のまま L だけ落とすと必ずグレーになる (v0 の失敗)。
 */
export type WashRole = "ground" | "accent" | "mid";

/** 役割の並び。`seasonalRolesFor` の返り値と `SeasonalPalette` は同じ添字。 */
export type SeasonalRoles = [WashRole, WashRole, WashRole, WashRole];

interface RoleShape {
  /** 目標明度。base の明度と `lBlend` で混ぜる。 */
  targetL: number;
  /** 目標明度への寄せ量 (0 = 月の色のまま、1 = 目標そのもの)。 */
  lBlend: number;
  /** 同じ役割が複数あるとき (mid) に明度を散らす幅。0 だと mid が団子になる。 */
  lSpread: number;
  /** 彩度の倍率。夜は 1 を大きく超える (下のコメント参照)。 */
  chromaScale: number;
  /** 彩度の下限。淡い月 (1月・12月) でも色が消えないための床。 */
  chromaFloor: number;
  /** 彩度の上限。既存 UI と喧嘩しないための天井。 */
  chromaCap: number;
  /**
   * 寄せ先の色相の候補。**元の色相にいちばん近いものが選ばれる**。
   *
   * 候補を複数持つのは、単一のアンカーへ全色を寄せると色相環の反対側にある色が
   * 「短い方の弧」を通って想定外の色になるため (実測: 9月夜の地が薄柿 48 度から
   * 藍 262 度へ寄って、途中のマゼンタ 335 度で止まり紫の地になった)。夜の地は
   * 藍か墨 (焦茶) のどちらかへ沈むのが正しく、暖色の月は焦茶側へ沈めばよい。
   */
  anchors: number[];
  /** 寄せる量 (0-1)。 */
  towardAmount: number;
}

/**
 * 時間帯 x 役割の効き方。
 *
 * 色相は「固定量だけ回す」のではなく **アンカー色相へ寄せる**。固定回転だと
 * 暖色と寒色で意味が逆になり、季節ごとに破綻するため (`mixHue` のコメント参照)。
 *
 * 夜の `towardAmount` を v0 の 0.28 から役割ごとに割り振り直してある。全色を同じ
 * 色相へ強く寄せると 4 色の色相差が消え、明度差だけの面 = モノクロになる。
 * 地と中間だけを藍へ寄せ、灯りは元の暖色を残す。
 */
const TIME_SHAPE: Record<TimeOfDay, Record<WashRole, RoleShape>> = {
  // 朝 — 紙は白く、色は締まって澄む。明暗差は小さいまま、色相差で見せる。
  morning: {
    ground: {
      targetL: 0.955,
      lBlend: 0.7,
      lSpread: 0,
      chromaScale: 0.7,
      chromaFloor: 0,
      chromaCap: 0.02,
      anchors: [96],
      towardAmount: 0.14,
    },
    accent: {
      targetL: 0.79,
      lBlend: 0.55,
      lSpread: 0,
      chromaScale: 2.1,
      chromaFloor: 0.058,
      chromaCap: 0.1,
      anchors: [104],
      towardAmount: 0.06,
    },
    mid: {
      targetL: 0.855,
      lBlend: 0.5,
      lSpread: 0.055,
      chromaScale: 1.6,
      chromaFloor: 0.032,
      chromaCap: 0.078,
      anchors: [104],
      towardAmount: 0.08,
    },
  },
  // 昼 — 基準。月の色をいちばん素直に出す時間帯だが、地と主役の差は開く。
  day: {
    ground: {
      targetL: 0.945,
      lBlend: 0.55,
      lSpread: 0,
      chromaScale: 0.78,
      chromaFloor: 0,
      chromaCap: 0.022,
      anchors: [],
      towardAmount: 0,
    },
    accent: {
      targetL: 0.775,
      lBlend: 0.5,
      lSpread: 0,
      chromaScale: 2.3,
      chromaFloor: 0.062,
      chromaCap: 0.105,
      anchors: [],
      towardAmount: 0,
    },
    mid: {
      targetL: 0.845,
      lBlend: 0.4,
      lSpread: 0.06,
      chromaScale: 1.7,
      chromaFloor: 0.034,
      chromaCap: 0.082,
      anchors: [],
      towardAmount: 0,
    },
  },
  // 夕 — 温度が上がり、影が出る。ここから地が暗い側に移る。
  dusk: {
    ground: {
      targetL: 0.5,
      lBlend: 0.72,
      lSpread: 0,
      chromaScale: 1.7,
      chromaFloor: 0.048,
      chromaCap: 0.075,
      anchors: [30, 285],
      towardAmount: 0.26,
    },
    accent: {
      targetL: 0.755,
      lBlend: 0.62,
      lSpread: 0,
      chromaScale: 2.9,
      chromaFloor: 0.088,
      chromaCap: 0.125,
      anchors: [48],
      towardAmount: 0.36,
    },
    mid: {
      targetL: 0.6,
      lBlend: 0.5,
      lSpread: 0.09,
      chromaScale: 2.0,
      chromaFloor: 0.048,
      chromaCap: 0.078,
      anchors: [40, 265],
      towardAmount: 0.18,
    },
  },
  // 夜 — 深く沈むが、色は点る。
  //
  // chromaScale が 1 を大きく超えるのは意図的。月の地の色は C = 0.006〜0.062 と
  // 極端に淡く、そのまま L だけ落とすと必ずグレーになる。L を落とす分だけ C を
  // 押し上げて初めて「深い藍」「濃紺」「墨」として読める。
  night: {
    ground: {
      targetL: 0.235,
      lBlend: 0.92,
      lSpread: 0,
      chromaScale: 2.6,
      chromaFloor: 0.045,
      chromaCap: 0.085,
      anchors: [258, 30],
      towardAmount: 0.5,
    },
    // 灯り。明度を落とさず (0.63)、彩度を最も高く取る一色。暗がりの中で
    // ここだけが点って見えることが「夜 = 灰色」からの脱出条件。
    accent: {
      targetL: 0.63,
      lBlend: 0.88,
      lSpread: 0,
      chromaScale: 3.4,
      chromaFloor: 0.088,
      chromaCap: 0.125,
      anchors: [62],
      towardAmount: 0.32,
    },
    mid: {
      targetL: 0.375,
      lBlend: 0.85,
      lSpread: 0.1,
      chromaScale: 2.0,
      chromaFloor: 0.048,
      chromaCap: 0.072,
      anchors: [250, 40],
      towardAmount: 0.2,
    },
  },
};

/**
 * 生成色の明度域。
 *
 * 床を v0 の 0.42 から 0.16 へ下げた。0.42 は「暗くしすぎない」ための床のつもり
 * だったが、実際には夜の地をそこで頭打ちにして 4 色を中明度に集める装置になって
 * いた (= 灰色化の直接原因)。深さは床ではなく役割ごとの目標明度で決める。
 */
const MIN_LIGHTNESS = 0.16;
const MAX_LIGHTNESS = 0.97;

/** 地を暗い側に置く時間帯か。夕から地が沈む。 */
const DARK_REGIME: Record<TimeOfDay, boolean> = {
  morning: false,
  day: false,
  dusk: true,
  night: true,
};

/** 2 つの色相の角距離 (0-180)。 */
function hueDistance(a: number, b: number): number {
  const delta = (((a - b) % 360) + 360) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/** 琥珀 (55 度) からの色相角距離。小さいほど暖かい。 */
function hueDistanceFromAmber(hue: number): number {
  return hueDistance(hue, 55);
}

/**
 * 4 色に役割を割り当てる。
 *
 * 地は regime で決まる (暗い時間帯は最も暗い色、明るい時間帯は最も明るい色)。
 * 主役は暗い時間帯なら **最も暖かい色** = 灯りになる色、明るい時間帯なら
 * **最も彩度の高い色**。地と主役が同じ色にならないよう、地を先に確定してから
 * 残りから主役を選ぶ。
 */
function assignRoles(quad: OklchQuad, dark: boolean): SeasonalRoles {
  const indices = [0, 1, 2, 3];
  const groundIndex = indices.reduce((best, i) =>
    (dark ? quad[i].l < quad[best].l : quad[i].l > quad[best].l) ? i : best,
  );
  const rest = indices.filter((i) => i !== groundIndex);
  const isBetterAccent = (i: number, best: number) =>
    dark
      ? hueDistanceFromAmber(quad[i].h) < hueDistanceFromAmber(quad[best].h)
      : quad[i].c > quad[best].c;
  const accentIndex = rest.reduce((best, i) =>
    isBetterAccent(i, best) ? i : best,
  );
  return indices.map((i) =>
    i === groundIndex ? "ground" : i === accentIndex ? "accent" : "mid",
  ) as SeasonalRoles;
}

/** 候補のうち、元の色相にいちばん近いものを返す。 */
function nearestAnchor(hue: number, anchors: number[]): number {
  return anchors.reduce((best, anchor) =>
    hueDistance(hue, anchor) < hueDistance(hue, best) ? anchor : best,
  );
}

function applyRoleShape(base: Oklch, shape: RoleShape, offsetL: number): Oklch {
  const l = base.l * (1 - shape.lBlend) + shape.targetL * shape.lBlend + offsetL;
  return {
    l: Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l)),
    c: Math.min(
      shape.chromaCap,
      Math.max(shape.chromaFloor, base.c * shape.chromaScale),
    ),
    h:
      shape.towardAmount === 0 || shape.anchors.length === 0
        ? base.h
        : mixHue(base.h, nearestAnchor(base.h, shape.anchors), shape.towardAmount),
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

/**
 * 月 + 時間帯 -> 4 色の役割。純関数。
 *
 * 面積配分に使う。`seasonalPaletteFor` と同じ添字で対応する。
 */
export function seasonalRolesFor(
  month: number,
  timeOfDay: TimeOfDay,
): SeasonalRoles {
  return assignRoles(MONTHLY_BASE[normalizeMonth(month)], DARK_REGIME[timeOfDay]);
}

/**
 * もとの 4 色 + 時間帯 -> 面の 4 色。純関数。
 *
 * 月の色から作る経路 (`seasonalPaletteFor`) と、号のテーマ色から作る経路
 * (`themePaletteFor`) の **共通の出口**。役割の割り当て・時間帯の効かせ方・
 * 彩度と明度の帯はすべてここに集約する。テーマ色側で式を書き直すと、
 * 「同じ夜なのに elxea journal だけ彩度帯が違う」がすぐ起きるため。
 */
export function shapePalette(
  base: OklchQuad,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  const roles = assignRoles(base, DARK_REGIME[timeOfDay]);
  const shapes = TIME_SHAPE[timeOfDay];

  // mid だけは複数あるので、元の明度の順位で上下に散らす。散らさないと
  // 中間層が 1 色に潰れて、面の階調が地と主役の 2 段しか無くなる。
  const midOrder = base
    .map((color, index) => ({ index, l: color.l }))
    .filter((entry) => roles[entry.index] === "mid")
    .sort((a, b) => a.l - b.l)
    .map((entry) => entry.index);

  const [a, b, c, d] = base.map((color, index) => {
    const role = roles[index];
    const shape = shapes[role];
    const rank = midOrder.indexOf(index);
    const offsetL =
      role === "mid" && midOrder.length > 1
        ? shape.lSpread * (rank - (midOrder.length - 1) / 2)
        : 0;
    return oklchToHex(applyRoleShape(color, shape, offsetL));
  });
  return [a, b, c, d];
}

/** 月 + 時間帯 -> 4 色。純関数。 */
export function seasonalPaletteFor(
  month: number,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  return shapePalette(MONTHLY_BASE[normalizeMonth(month)], timeOfDay);
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
