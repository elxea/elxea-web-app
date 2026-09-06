/**
 * roji のデータ表現 (味の四象限 / 香りの場 / 土地を読む) が使う描画色。
 *
 * ## なぜ semantic token をそのまま使わないのか
 *
 * この 3 枚は Canvas / SVG filter / MapLibre の paint プロパティで描く。いずれも
 * CSS ではないので `var(--color-brand-sand)` も `oklch(...)` も解決されない
 * (`lib/viz/map-style.ts` の冒頭に同じ事情が書いてある)。よって描画用の実値を
 * 1 か所に集める。
 *
 * ## なぜトークンの写しではなく別の値なのか
 *
 * ブランドトークンの cream `#ebe9e0` / sand `#d5d3c0` / stone `#adaca0` は
 * **UI の地と罫**として設計された色で、彩度がほぼゼロに寄せてある。データ表現の
 * 面 (段彩・濃度場・にじみ) を同じ色域で塗ると、段が 4 つ並んでも差が読めない。
 * 3 枚が使うのは roji の「紙と草」の側の色 — 生成り / 墨 / 苔 / 砂 — で、
 * これは Setaka 確定のデータ表現パレット (2026-08-17) を正本とする。
 *
 * どちらも低彩度・同じ色相帯にあるので UI と喧嘩しない。ただし **トークンの写し
 * ではない**ので、トークンが動いてもここは追随しない (追随させると意味が変わる)。
 *
 * 数値を画面に出さないのが roji の原則で、標高だけが例外。
 * 出典: viz 査定 `verdicts.md` (第3ラウンド 20 系 / 第6ラウンド 候補 30)。
 */

/** データ表現の 4 色 + 派生色。すべて低彩度。 */
export const ROJI_VIZ_COLOR = {
  /** 生成り — 地 (紙) */
  kinari: "#F5F1E8",
  /** 墨 — 線・文字 */
  sumi: "#2B2B2B",
  /** 苔 — 主となる草の色 */
  koke: "#7A8B6F",
  /** 砂 — 地に近い中間色 */
  suna: "#C9BFA8",
  /** 深緑 — 苔の暗部 */
  fukamidori: "#5C6552",
  /** 焙じ茶 — 火の側 */
  hoji: "#8A6E55",
  /** 焙じ深 — 火の暗部 */
  hojiFuka: "#6B4F3A",
  /** 淡い苔 — 苔の明部 */
  usukoke: "#9AA88F",
} as const;

export type RojiVizColorName = keyof typeof ROJI_VIZ_COLOR;

/**
 * 図の中の文字に使う明朝の指定。
 *
 * 本文の書体は DS のトークンが決めるが、Canvas の `ctx.font` と SVG の
 * `font-family` 属性はトークンを解決できないので、ここに実値を置く。
 */
export const ROJI_VIZ_SERIF =
  '"Hiragino Mincho ProN","Yu Mincho",YuMincho,serif';

/** `#rrggbb` → `[r, g, b]`。 */
export function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** `[[値, '#rrggbb'], ...]` を線形補間する関数を作る (段彩・あたたかさの色域)。 */
export function rampFn(
  stops: readonly (readonly [number, string])[]
): (value: number) => [number, number, number] {
  const parsed = stops.map(
    ([v, c]) => [v, hexToRgb(c)] as [number, [number, number, number]]
  );
  return (value) => {
    if (value <= parsed[0][0]) return parsed[0][1];
    for (let i = 1; i < parsed.length; i++) {
      if (value <= parsed[i][0]) {
        const t = (value - parsed[i - 1][0]) / (parsed[i][0] - parsed[i - 1][0]);
        const a = parsed[i - 1][1];
        const b = parsed[i][1];
        return [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
      }
    }
    return parsed[parsed.length - 1][1];
  };
}

/** 決定的な擬似乱数 (線形合同法)。同じ種なら毎回同じ絵になる。 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 0..1 に丸める。 */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 目に見える明るさ (0..255)。`0.2126R + 0.7152G + 0.0722B` の素の重みづけ。
 *
 * WCAG の相対輝度 (下の `relativeLuminance`) と違ってガンマを戻さないので、
 * **画素の値をそのまま人が「暗い」と言う感覚に近い順番**に並べられる。
 * 「黒・近黒を大面積に使わない」の判定はこちらで行う (墨 `#2B2B2B` は 43)。
 */
export function perceivedLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x の相対輝度 (0..1)。コントラスト比の計算に使う。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x のコントラスト比 (1..21)。可読の基準は本文で 4.5:1。
 *
 * 図の中の字は Canvas に描くので、DS のトークンや CSS の検査 (axe) が届かない。
 * 数値で固定できるのはここだけなので、比の計算をこの 1 か所に置く。
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}
