/**
 * OKLCH <-> sRGB conversion (dependency-free).
 *
 * Why this exists: roji の「眺め」= 情動レイヤーの色は、デザイントークンのような
 * 固定値ではなく **季節と時刻から生成される** 値である。生成するには色空間の中で
 * 明度・彩度・色相を連続的に動かす必要があり、そのための最小限の変換だけをここに置く。
 *
 * OKLCH を選ぶ理由は既存のデザイントークン (`dist/tokens.css`) がすべて OKLCH で
 * 書かれているため。同じ色空間で生成すれば、既存 UI の彩度域 (C ≈ 0.006〜0.06、
 * brand-gold の 0.173 のみ例外) と数値で突き合わせられる。
 *
 * 実装は Björn Ottosson の OKLab 定義 (https://bottosson.github.io/posts/oklab/) と
 * CSS Color 4 の sRGB transfer function に従う。
 */

export interface Oklch {
  /** Perceptual lightness. 0 = black, 1 = white. */
  l: number;
  /** Chroma. 0 = achromatic. sRGB で表現できる上限は色相により 0.1〜0.37 程度。 */
  c: number;
  /** Hue angle in degrees. 0-360. */
  h: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Linear-light sRGB channel -> gamma-encoded sRGB channel. */
function gammaEncode(channel: number): number {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/** Gamma-encoded sRGB channel -> linear-light sRGB channel. */
function gammaDecode(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

function oklchToLinearRgb({ l, c, h }: Oklch): LinearRgb {
  const hRad = h * DEG_TO_RAD;
  const a = c * Math.cos(hRad);
  const bb = c * Math.sin(hRad);

  const lCbrt = l + 0.3963377774 * a + 0.2158037573 * bb;
  const mCbrt = l - 0.1055613458 * a - 0.0638541728 * bb;
  const sCbrt = l - 0.0894841775 * a - 1.291485548 * bb;

  const lLms = lCbrt * lCbrt * lCbrt;
  const mLms = mCbrt * mCbrt * mCbrt;
  const sLms = sCbrt * sCbrt * sCbrt;

  return {
    r: 4.0767416621 * lLms - 3.3077115913 * mLms + 0.2309699292 * sLms,
    g: -1.2684380046 * lLms + 2.6097574011 * mLms - 0.3413193965 * sLms,
    b: -0.0041960863 * lLms - 0.7034186147 * mLms + 1.707614701 * sLms,
  };
}

function isDisplayable({ r, g, b }: LinearRgb): boolean {
  // 0 側にわずかな許容を置く: 変換の丸め誤差で -1e-7 のような値が出るため。
  const min = -1e-6;
  const max = 1 + 1e-6;
  return r >= min && r <= max && g >= min && g <= max && b >= min && b <= max;
}

/**
 * Reduce chroma until the color fits inside sRGB, keeping lightness and hue.
 *
 * 明度と色相を保ったまま彩度だけを落とすのは、単純な RGB クランプと違って
 * 色相が転ばない (クランプは彩度の高い色の色相をずらす) ため。
 * 本コンポーネントの色域は元々 C <= 0.08 程度なので通常この縮約は発生しない。
 */
export function clampToSrgbGamut(color: Oklch): Oklch {
  if (isDisplayable(oklchToLinearRgb(color))) return color;

  let lo = 0;
  let hi = color.c;
  // 20 回で C の精度は 1e-6 未満になる (初期幅 <= 0.4)。
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (isDisplayable(oklchToLinearRgb({ ...color, c: mid }))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { ...color, c: lo };
}

function toHexChannel(value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return byte.toString(16).padStart(2, "0");
}

/** OKLCH -> `#rrggbb`. Out-of-gamut colors are chroma-reduced, not clipped. */
export function oklchToHex(color: Oklch): string {
  const safe = clampToSrgbGamut({
    l: Math.min(1, Math.max(0, color.l)),
    c: Math.max(0, color.c),
    h: ((color.h % 360) + 360) % 360,
  });
  const linear = oklchToLinearRgb(safe);
  return `#${toHexChannel(gammaEncode(linear.r))}${toHexChannel(
    gammaEncode(linear.g),
  )}${toHexChannel(gammaEncode(linear.b))}`;
}

/** `#rgb` / `#rrggbb` -> OKLCH. Throws on malformed input (callers pass literals). */
export function hexToOklch(hex: string): Oklch {
  const normalized = hex.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const r = gammaDecode(parseInt(expanded.slice(0, 2), 16) / 255);
  const g = gammaDecode(parseInt(expanded.slice(2, 4), 16) / 255);
  const b = gammaDecode(parseInt(expanded.slice(4, 6), 16) / 255);

  const lLms = Math.cbrt(
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
  );
  const mLms = Math.cbrt(
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
  );
  const sLms = Math.cbrt(
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  );

  const l = 0.2104542553 * lLms + 0.793617785 * mLms - 0.0040720468 * sLms;
  const a = 1.9779984951 * lLms - 2.428592205 * mLms + 0.4505937099 * sLms;
  const bAxis = 0.0259040371 * lLms + 0.7827717662 * mLms - 0.808675766 * sLms;

  const c = Math.sqrt(a * a + bAxis * bAxis);
  const h = c < 1e-7 ? 0 : ((Math.atan2(bAxis, a) * RAD_TO_DEG) % 360 + 360) % 360;

  return { l, c, h };
}

/**
 * Rotate `from` toward `to` along the shorter arc by `amount` (0-1).
 *
 * 時間帯の演出 (夕方は橙へ、夜は藍へ) を「色相を固定量だけ回す」ではなく
 * 「アンカー色相へ寄せる」で表現するために使う。固定量の回転は暖色と寒色で
 * 逆方向の意味になってしまい、季節ごとに破綻するため採らない。
 */
export function mixHue(from: number, to: number, amount: number): number {
  const a = ((from % 360) + 360) % 360;
  const b = ((to % 360) + 360) % 360;
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return ((a + delta * amount) % 360 + 360) % 360;
}
