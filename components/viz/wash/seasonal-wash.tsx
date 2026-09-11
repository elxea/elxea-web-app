"use client";

import { useEffect, useRef } from "react";

import { hexToOklch, oklchToHex } from "@/lib/viz/color";
import {
  buildStrokeSeeds,
  dabScatter,
  lateralDrift,
  makeFlowField,
  pathDensity,
  strokeEnvelope,
  strokeLifeEnvelope,
  strokeLifeProgress,
  traceStroke,
  STROKE_STEPS,
  type StrokeSeed,
} from "@/lib/viz/flow-field";
import { paperGrainTile } from "@/lib/viz/paper-grain";
import {
  prefersReducedMotion,
  resolveMotion,
} from "@/lib/viz/seasonal-wash-motion";
import {
  paletteMeanLightness,
  resolveWashIntensity,
  scaleWashEmphasis,
  washEmphasisFor,
  MID_RIM_SPREAD_LIMIT,
  type WashEmphasis,
  type WashIntensity,
} from "@/lib/viz/wash-emphasis";

/**
 * SeasonalWash — 季節のにじみ (roji 情動レイヤー v1)
 *
 * 色の塊がごく遅く漂って混ざるだけの面。数値・ラベル・凡例は一切出さない
 * (コンセプト第3節「5則」)。何を意味するか分からなくても成立することが要件。
 *
 * ## v0 から何を変えたか
 * v0 は同心円の radial gradient を重ねる作りだった。実物を見ると絵ではなく
 * **ぼかした写真** で、しかも夜が無彩色に潰れていた。v1 は描画の語彙そのものを
 * 入れ替える:
 *
 * 1. **等方の円 → 流れに沿った細長い滲み。** 画面全体に一本の緩やかな流れ
 *    (フローフィールド) を敷き、塊はその流れに沿って走る細長い形になる。
 *    向きが揃うことで、面に「どちらへ流れているか」が生まれる。
 * 2. **境界を全部ぼかさない。** 色が出会うところに薄い濃度差 (にじみの縁) を残す。
 *    水彩が乾くときに縁へ顔料が寄る現象と同じで、これが無いと絵に見えない。
 *    ただし全ストロークには付けない (付けると筆致が数えられて工業的になる)。
 * 3. **夜の配色を彩度で作る。** 色の設計は `lib/viz/seasonal-palette.ts` 側。
 *
 * ## 実装上の選択と、その理由
 * - **canvas 2D。WebGL でもライブラリでもない。** 流れに沿ったスタンプを重ねる
 *   だけなら 2D で足りる。シェーダを入れるとフォールバックの二重設計が即発生する。
 * - **スタンプは事前に作った小さな画像を貼る。** 毎フレーム gradient を作り直すと
 *   重い。色ごとに 1 枚だけ作って `drawImage` で回転・引き伸ばして貼る。
 * - **低解像度で描いて CSS で拡大 + 少しぼかす。** ただし v0 より解像度を上げ、
 *   ぼかしを弱めた (0.25 / 26px → 0.36 / 9px)。v0 の設定は流れも縁も溶かし切って
 *   しまい、何を描いても同じ霞になる。
 * - **30fps 目安。** 揺らぎは遅いほど roji らしく、性能要求と思想が一致する。
 * - **乱数は seed から決定的に作る。** ハイドレーションのズレもスクリーンショットの
 *   揺れも構造的に起きない。
 *
 * 動きの正本はコード、色の正本は季節パレット (`lib/viz/seasonal-palette.ts`)。
 * 参照: https://www.notion.so/3b970c9d064c816da7b3c0bf2c15557f
 */

export interface SeasonalWashProps {
  /** にじみの色。4〜6 色を想定 (`seasonalPalette()` は 4 色を返す)。 */
  palette: string[];
  /** 動きの速さ。0.5 (とても遅い) 〜 2。既定 1。 */
  tempo?: number;
  /**
   * 紙の粒子を重ねるか。**既定 on**。
   *
   * v0 では既定 off だったが、実物を並べると粒のある 1 枚だけが roji らしかった。
   * 粒は「古びた紙」ではなく **面に触感を与える** 役目で、無いと画面が液晶の
   * つるつるした光になる。
   */
  grain?: boolean;
  /** 絵柄の seed。同じ値なら必ず同じ絵になる。既定 1。 */
  seed?: number;
  /**
   * この面でどれだけ強く出すか。`"base"` (既定) / `"soft"` または 0-1 の数値。
   *
   * 配色ごとの置き方 (`washEmphasisFor`) とは別の軸。あちらは「この配色を
   * どう置けば図形に見えないか」で、こちらは「この **面** がどれだけ出して
   * よいか」。読みもの系の背景は本文の後ろに敷くので `"soft"` を渡す。
   * 詳細と数値の根拠は `lib/viz/wash-emphasis.ts` の `WashIntensity` 参照。
   */
  intensity?: WashIntensity;
  className?: string;
}

/**
 * 実寸に対する内部解像度の比。
 *
 * v0 の 0.25 から上げた。0.25 + 強いぼかしでは流れの向きも色の境界も残らず、
 * 何を描いても同じ霞になっていた。
 */
const RENDER_SCALE = 0.36;
/** 内部解像度の下限 (これ以下だと塊の形が破綻する)。 */
const MIN_RENDER_PX = 64;
/**
 * CSS 側のぼかし量 (px)。
 *
 * v0 の 26px から下げた。ぼかしは「低解像度の拡大で出た階段を均す」ためだけに
 * 使い、にじみそのものはスタンプの重ねで作る。上げすぎると縁が消える。
 */
const BLUR_PX = 9;
/** ぼかしで縁が透けるので、その分だけ拡大して逃がす。 */
const OVERSCAN = 1.14;

/**
 * ストロークの本数。
 *
 * 9 本では画面の半分が地のまま残った (実測)。増やすほど筆致は数えられなくなるが、
 * 増やしすぎると全部が重なって平均色 = 泥になる。
 *
 * 18 本から 26 本に上げた。筆を細くした (`buildStrokeSeeds` の `width`) ので、
 * 同じ本数だと塗りの総量が落ちて画面の大半が地のまま残る。細い筆 x 多い本数の方が、
 * 太い筆 x 少ない本数より「にじみ」に見える (太い筆は 1 本が塊として読める)。
 */
const STROKE_COUNT = 26;
/** スタンプ画像の一辺 (px)。拡大して使うので実寸より小さくてよい。 */
const SPRITE_SIZE = 128;

/**
 * 流れの基準方向 (ラジアン)。右上がりの緩い斜め。
 *
 * 水平でも垂直でもない角度にするのは、画面の枠と平行になると「レイアウトの線」に
 * 見えてしまうため。
 */
const FLOW_BASE_ANGLE = -0.38;
/** 蛇行の強さ。大きいと渦になり、小さいと平行線になる。 */
const FLOW_TURN = 0.95;

/**
 * 実時間 -> 場の時間の倍率。
 *
 * 場が一周するのに約 100 秒。眺めは遅いほど roji らしいが、遅すぎると
 * 「止まっている」と誤解される。30 秒眺めて変化に気づく程度を狙う。
 */
const FIELD_TIME_SCALE = 0.35;
/** ストローク 1 本の一生 (場の時間で)。実時間で約 90 秒。 */
const STROKE_LIFE = 31;

/**
 * 種を上流へ戻す量 (画面の高さに対する比)。
 *
 * 種は経路の **始点** であって重心ではない。ストロークの重心は種から
 * 「経路長の半分 + 一生の移動量の半分」だけ下流にある。ここを戻しておかないと、
 * 時間で均した密度が下流に偏る (実測: 5 枚すべてで左下が地のまま残った)。
 *
 * 経路長の平均 1.52 の半分 = 0.76、`travel` の平均 0.43 の半分 = 0.21。合わせて 0.97。
 * v1 初版が 0.21 だったのは経路が短かった (平均 0.73) 頃の値で、経路を倍以上に
 * 伸ばした今はこの補正も伸ばさないと釣り合わない。
 */
const ORIGIN_SHIFT = 0.97;
/**
 * 種を流れ方向に散らす幅 (画面の高さに対する比)。
 *
 * 経路長の平均 1.45 と同程度。ストロークが濃く出るのは中ほど 6 割だけなので、
 * 全部を同じ量だけ上流へ戻すと濃い部分が一箇所に集まり、画面に 1 本の太い尾根が
 * できる (実測: 左上 4 割が地のまま残った)。開始点を経路長ぶん散らして解く。
 */
const ORIGIN_SPREAD = 1.45;
/**
 * 上流への戻しを計算するときの想定縦横比。
 *
 * 種を作る時点では実寸が確定していない (`resize` より前) ので、代表値として
 * 16:10 を使う。これは絵の重心を整えるための補正なので、多少ずれても破綻しない。
 */
const NOMINAL_ASPECT = 1.6;

/** 紙の粒子タイルの一辺 (px) と、いちばん濃いところの透明度 (0-255)。 */
const GRAIN_TILE = 220;
const GRAIN_INTENSITY = 30;

/**
 * どちらの明度側を地に取るかの境目。
 *
 * `lib/viz/wash-emphasis.ts` の `DARK_PALETTE_PIVOT` / `LIGHT_PALETTE_PIVOT` とは
 * 別物なので混ぜない。あちらは「色をどれだけ点らせるか」を連続的に決める補間の
 * 両端で、こちらは「4 色のうちどれを地にするか」という二択の境目。役割が違う。
 */
const GROUND_PIVOT = 0.7;

const TAU = Math.PI * 2;

interface ColorRole {
  hex: string;
  /** 地 (面積いちばん広い) / 主役 / 中間。 */
  role: "ground" | "accent" | "mid";
}

/**
 * 配色から役割を読み取る。
 *
 * パレットは 4 色の hex しか渡ってこない (props 互換のため) ので、色そのものから
 * 逆算する。`lib/viz/seasonal-palette.ts` が付けた役割と一致するように作ってあるが、
 * 任意のパレットを渡されても破綻しない。
 *
 * - 明るい配色 (朝・昼) → いちばん明るい色が地。生成りの紙の上に色が滲む
 * - 暗い配色 (夜) → いちばん暗い色が地。明るい色が「奥から出てくる光」になり、
 *   障子越しの光・行灯の語彙に一致する
 *
 * 固定ルールを両方とも試して捨てた経緯がある。常に明るい色を地にすると夜が
 * 濁った霞になり、常に暗い色を地にすると朝から生成りの温かみが消える。どちらの
 * 失敗も原因は同じで、**地を少数派の明度側に置くと面全体が中明度へ潰れる**。
 */
function readRoles(colors: string[]): ColorRole[] {
  const measured = colors.map((hex) => {
    try {
      const { l, c } = hexToOklch(hex);
      return { hex, l, c };
    } catch {
      // 解釈できない色は中間扱い。canvas は塊としてそのまま描ける。
      return { hex, l: 0.5, c: 0 };
    }
  });

  const mean = measured.reduce((sum, m) => sum + m.l, 0) / measured.length;
  const wantLightestGround = mean >= GROUND_PIVOT;

  let groundIndex = 0;
  for (let i = 1; i < measured.length; i += 1) {
    const better = wantLightestGround
      ? measured[i].l > measured[groundIndex].l
      : measured[i].l < measured[groundIndex].l;
    if (better) groundIndex = i;
  }

  // 主役は地を除いていちばん彩度の高い色。夜は灯り、昼はいちばん色のある一色。
  let accentIndex = -1;
  for (let i = 0; i < measured.length; i += 1) {
    if (i === groundIndex) continue;
    if (accentIndex === -1 || measured[i].c > measured[accentIndex].c) {
      accentIndex = i;
    }
  }

  return measured.map((m, i) => ({
    hex: m.hex,
    role:
      i === groundIndex ? "ground" : i === accentIndex ? "accent" : ("mid" as const),
  }));
}

/**
 * 役割ごとの筆の性格。
 *
 * ## v2-fix — 主役の値はここに無い (配色から決まる)
 * 下の `accent` は **明るい配色のときの値** ではなく、`ROLE_STYLE` に居残った
 * 形骸ではない。主役の置き方は配色の平均明度から `washEmphasisFor` が返すので、
 * ここには置かない。理由は `lib/viz/wash-emphasis.ts` の冒頭に書いた:
 * 同じ濃度でも、明るい地では「染み」、暗い地では「光」として読まれ、
 * 弱め方を一律にすると必ずどちらかが壊れる (v2 は夜を壊した)。
 *
 * ## v1-fix で分かったこと — 比率ではなく「置き方」が違っていた
 * 同じ 1 枚の中で、地と中間色 (淡い桃色・青灰) は **広い面** としてゆるく
 * 重なり、境界が場所によって濃かったり消えたりしていた = にじみ。ところが
 * 主役の色だけが、太さのほぼ一定な連続した帯として画面を横切っていた = 図形。
 *
 * 原因はスタンプと経路の比 (`dabToPathRatio`) ではない。**主役だけ塗り方が
 * 地と違っていた** ことにある。地は面として置かれ、主役は筆で引いた線だった。
 * そこで主役の設定を「細く・濃く・上に乗せる」から、地と同じ「広く・薄く・
 * 混ぜる」へ入れ替える:
 *
 * - `width` を 2.2 倍にして **線ではなく面** の幅にする (細いほど線に見える)
 * - `alpha` を 1/3.5 にして地と混ぜる。紙の粒子が透けて見える濃度まで落とす
 * - `elongation` を下げて丸いスタンプにする (細長さは経路が担う)
 * - `weight` を上げて本数を増やす。1 本の存在感ではなく **重なり** で出す
 * - `mottleDepth` を上げて長さ方向に切れ目を作る (`pathDensity`)
 * - `spread` で中心線をゆらし、管ではなく斑の広がりにする (`lateralDrift`)
 * - `rim` を切る。縁は全長にわたる均質な輪郭そのもので、図形に見える主因
 *
 * 濃さの総量 (濃度 x 面積 x 本数) はおおよそ保たれるので、色そのものは消えない。
 * 芯の濃度だけが半分以下になる。
 */
interface RoleStyle {
  weight: number;
  width: number;
  alpha: number;
  elongation: number;
  mottleDepth: number;
  spread: number;
  rim: boolean;
}

/**
 * 地と中間色の置き方。配色によらず一定でよい部分。
 *
 * 主役だけが配色依存なのは、地と中間は「面としてゆるく重なる」置き方が
 * 明暗どちらでも成立しているため (v1 / v2 の実物で確認済み)。中間色は暗い配色で
 * 濃さだけを押し上げる (`WashEmphasis.midAlpha`)。形は変えない。
 */
const BASE_ROLE_STYLE = {
  ground: {
    weight: 1,
    width: 1.3,
    alpha: 0.85,
    elongation: 1.1,
    mottleDepth: 0.26,
    spread: 0,
    rim: true,
  },
  mid: {
    weight: 1.35,
    width: 1.05,
    alpha: 1.2,
    elongation: 1,
    mottleDepth: 0.26,
    spread: 0,
    rim: true,
  },
} as const;

/**
 * 配色の明るさを織り込んだ、役割ごとの筆の性格。
 *
 * 主役は `washEmphasisFor` の返り値そのもの、中間は濃さだけを配色で調整、
 * 地は不変。縁 (`rim`) は主役では常に切る — 全長にわたる均質な輪郭は
 * 明暗どちらでも図形化の主因だった。
 */
function roleStylesFor(emphasis: WashEmphasis): Record<
  ColorRole["role"],
  RoleStyle
> {
  return {
    ground: BASE_ROLE_STYLE.ground,
    mid: {
      ...BASE_ROLE_STYLE.mid,
      alpha: BASE_ROLE_STYLE.mid.alpha * emphasis.midAlpha,
      spread: emphasis.midSpread,
      mottleDepth: emphasis.midMottleDepth,
      // 散らした層に均質な縁を重ねると打ち消し合う (`MID_RIM_SPREAD_LIMIT`)。
      rim:
        BASE_ROLE_STYLE.mid.rim &&
        emphasis.midSpread <= MID_RIM_SPREAD_LIMIT,
    },
    accent: {
      weight: emphasis.weight,
      width: emphasis.width,
      alpha: emphasis.alpha,
      elongation: emphasis.elongation,
      mottleDepth: emphasis.mottleDepth,
      spread: emphasis.spread,
      rim: false,
    },
  };
}

/**
 * 役割の性格を焼き込んだストローク。
 *
 * `StrokeSeed` は「どこをどう走るか」だけを持つ純粋な形の記述で、塗り方
 * (むらの深さ・広がり・縁の有無) は役割から来る。描画側で毎点 `ROLE_STYLE` を
 * 引き直さずに済むよう、種を作る時点で 1 本ずつに畳んでおく。
 */
interface PaintedStroke extends StrokeSeed {
  /** 長さ方向の濃度むらの深さ。大きいほど途中で消える (`pathDensity`)。 */
  mottleDepth: number;
  /** 中心線を直交方向へゆらす量 (筆の半径を単位とする)。0 で管のまま。 */
  spread: number;
}

/**
 * 描く順。地 -> 中間 -> 主役。
 *
 * 主役を中間色の下に回す案を実測して捨てた。淡い中間色が主役の上を全面的に
 * 覆うと、**画面全体が灰色のベールを被る**。12月夜の藍と灯りが濁った灰青に
 * なり、10月昼は主役の金が消えて無地のオフホワイトになった。
 *
 * 地と混ざるかどうかを決めるのは重ね順ではなく **濃度** で、そちらは
 * `ROLE_STYLE.accent.alpha` を下げて解いてある (下の層が透ける)。
 */
const DRAW_ORDER = { ground: 0, mid: 1, accent: 2 } as const;

/**
 * にじみの縁の色。
 *
 * 明度を落として彩度を上げた同系色。水彩が乾くときに縁へ顔料が寄って、
 * その部分だけ濃く出る現象をそのまま数値にしている。
 */
function rimColor(hex: string): string {
  try {
    const { l, c, h } = hexToOklch(hex);
    return oklchToHex({ l: Math.max(0.1, l - 0.075), c: c * 1.45, h });
  } catch {
    return hex;
  }
}

/**
 * 柔らかい滲みのスタンプを 1 枚作る。
 *
 * 中心を濃く、外へ一気に薄く。中間を厚くすると塊どうしが混ざりきって面が均一に
 * なる (= 色が消える) ため、落ち方は速めにしてある。
 */
function makeDabSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const half = SPRITE_SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  // 落ち方をゆるめてある。急に落とすと、重ね塗りで芯が飽和したときに
  // 「濃い部分」と「地」の境が細い帯に集中し、縁の立った図形に見える
  // (実測: 10月昼の金茶が錠剤形になった)。
  gradient.addColorStop(0, withAlpha(color, 1));
  gradient.addColorStop(0.3, withAlpha(color, 0.66));
  gradient.addColorStop(0.58, withAlpha(color, 0.28));
  gradient.addColorStop(0.82, withAlpha(color, 0.07));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return sprite;
}

/**
 * にじみの縁のスタンプ (輪) を 1 枚作る。
 *
 * 中心は透明で、外周の少し内側だけが濃い。これを経路に沿って重ねると、
 * ストロークの輪郭線ではなく **シルエットの外側に沿った濃度の尾根** ができる。
 * 輪郭線として引くと硬い線になるので、輪の重ね合わせで作るのが要点。
 */
function makeRimSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const half = SPRITE_SIZE / 2;
  // 輪の幅を広げてある (0.70-0.95 -> 0.55-1.00)。細い輪は、粒を小さくして
  // 密に重ねると **同心円のリング** として読めてしまう。幅の広いなだらかな山に
  // すると、重ね合わせが経路の外側の濃度差だけを残す。
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(0.55, withAlpha(color, 0));
  gradient.addColorStop(0.82, withAlpha(color, 1));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return sprite;
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const r = parseInt(expanded.slice(0, 2), 16) || 0;
  const g = parseInt(expanded.slice(2, 4), 16) || 0;
  const b = parseInt(expanded.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function paintGrain(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  seed: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const tile = document.createElement("canvas");
  tile.width = GRAIN_TILE;
  tile.height = GRAIN_TILE;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return;

  const image = tileCtx.createImageData(GRAIN_TILE, GRAIN_TILE);
  image.data.set(
    paperGrainTile({ size: GRAIN_TILE, seed, intensity: GRAIN_INTENSITY }),
  );
  tileCtx.putImageData(image, 0, 0);

  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function SeasonalWash({
  palette,
  tempo = 1,
  grain = true,
  seed = 1,
  intensity = "base",
  className,
}: SeasonalWashProps) {
  // 面の強さは 3 値に開く。濃度は描画へ、不透明度は面全体へ掛ける。
  const { deposit, opacity } = resolveWashIntensity(intensity);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const washRef = useRef<HTMLCanvasElement | null>(null);
  const grainRef = useRef<HTMLCanvasElement | null>(null);

  // 配列 prop をそのまま依存に置くと毎レンダーで再初期化されるため、値で比較する。
  const paletteKey = palette.join(",");

  useEffect(() => {
    const host = hostRef.current;
    const canvas = washRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const colors = paletteKey.split(",").filter(Boolean);
    if (colors.length === 0) return;

    const roles = readRoles(colors);
    const ground = roles.find((r) => r.role === "ground")?.hex ?? colors[0];

    // 「色をどれだけ点らせるか」は配色の明るさで決まる。暗い夜の配色なら
    // 主役は濃く狭くまとまった光になり、明るい昼の配色なら広く薄い染みになる。
    // 面の強さは濃度にだけ掛ける。形 (太さ・横ゆれ・切れ目) は配色が決めた
    // ままにする — 弱めるつもりで形まで縮めると帯が戻る (`scaleWashEmphasis`)。
    const roleStyle = roleStylesFor(
      scaleWashEmphasis(washEmphasisFor(paletteMeanLightness(colors)), deposit),
    );

    const dabs = roles.map((r) => makeDabSprite(r.hex));
    const rims = roles.map((r) => makeRimSprite(rimColor(r.hex)));

    const field = makeFlowField({
      baseAngle: FLOW_BASE_ANGLE,
      turn: FLOW_TURN,
      seed,
    });

    // 役割の重みで本数を配り、そのあと役割ごとの性格 (太さ・濃さ) を掛ける。
    const rawSeeds = buildStrokeSeeds({
      weights: roles.map((r) => roleStyle[r.role].weight),
      count: STROKE_COUNT,
      seed: seed + 101,
      originShift: {
        x: (-Math.cos(FLOW_BASE_ANGLE) * ORIGIN_SHIFT) / NOMINAL_ASPECT,
        y: -Math.sin(FLOW_BASE_ANGLE) * ORIGIN_SHIFT,
      },
      originJitter: {
        x: (Math.cos(FLOW_BASE_ANGLE) * ORIGIN_SPREAD) / NOMINAL_ASPECT,
        y: Math.sin(FLOW_BASE_ANGLE) * ORIGIN_SPREAD,
      },
    });
    const strokes: PaintedStroke[] = rawSeeds
      .map((s) => {
        const style = roleStyle[roles[s.colorIndex]?.role ?? "mid"];
        return {
          ...s,
          width: s.width * style.width,
          alpha: s.alpha * style.alpha,
          elongation: s.elongation * style.elongation,
          mottleDepth: style.mottleDepth,
          spread: style.spread,
          // 種は 3 本に 1 本が縁付きだが、役割が縁を許さないなら落とす。
          rim: s.rim && style.rim,
        };
      })
      .sort(
        (a, b) =>
          DRAW_ORDER[roles[a.colorIndex]?.role ?? "mid"] -
          DRAW_ORDER[roles[b.colorIndex]?.role ?? "mid"],
      );

    const plan = resolveMotion({
      tempo,
      reducedMotion: prefersReducedMotion(
        typeof window === "undefined" ? null : window,
      ),
    });

    let width = 1;
    let height = 1;
    let rafId = 0;
    let lastFrameAt = 0;
    let elapsedSec = 0;
    let lastTickAt = 0;
    let running = false;
    let visible = true;
    let onScreen = true;

    /** 経路に沿ってスタンプを重ねる。 */
    const stampStroke = (
      stroke: PaintedStroke,
      sprite: HTMLCanvasElement,
      time: number,
      lifeProgress: number,
      scale: number,
      alphaScale: number,
    ) => {
      const points = traceStroke(field, stroke, {
        aspect: width / height,
        steps: STROKE_STEPS,
        time,
        lifeProgress,
      });
      const life = strokeLifeEnvelope(lifeProgress);
      const radius = (stroke.width * height) / 2;
      // むらの位相。本ごとに違う位置に濃淡が出るよう、種の値から決める。
      const mottlePhase = stroke.lifePhase * TAU + stroke.angleBias * 3;

      for (const point of points) {
        const envelope = strokeEnvelope(point.progress);
        // 経路に沿って濃さをゆらす。均一に塗ると内部がのっぺりして、
        // にじみではなく **貼った図形** に見える (実測: 10月昼の金茶)。
        // 水彩が乾くときに顔料が溜まる / 抜けるムラを、低い周波数で真似る。
        // 主役の色は深いむらを掛けて **途中で消える** ようにする。全長で同じ
        // 濃さのまま走ると、それだけで 1 本のリボンとして読めてしまう。
        const mottle = pathDensity(point.progress, mottlePhase, stroke.mottleDepth);
        const alpha = stroke.alpha * envelope * life * mottle * alphaScale;
        if (alpha <= 0.002) continue;

        // 経路の中ほどを太く。均一な太さだと帯 (工業的な形) に見える。
        // さらに輪郭を少しゆらして、レンズのような滑らかな紡錘形を崩す。
        const wobble =
          1 +
          0.2 * Math.sin(point.progress * 5.1 - mottlePhase) +
          0.1 * Math.sin(point.progress * 11.7 + mottlePhase * 2);
        // 主役だけ 1 枚ごとに大小を混ぜる。同じ半径で並べると、union の縁が
        // 中心線から等距離の包絡線になり、輪郭を目で追える帯になる。
        const scatter =
          stroke.spread === 0 ? 1 : dabScatter(point.progress, mottlePhase);
        const r = radius * (0.72 + 0.28 * envelope) * wobble * scatter * scale;

        // 中心線を流れと直交する向きへずらす。経路そのものに置くと管になる。
        const offset =
          stroke.spread === 0
            ? 0
            : lateralDrift(point.progress, mottlePhase) *
              stroke.spread *
              radius;
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.translate(
          point.x * width - Math.sin(point.angle) * offset,
          point.y * height + Math.cos(point.angle) * offset,
        );
        ctx.rotate(point.angle);
        ctx.scale(stroke.elongation, 1);
        ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
        ctx.restore();
      }
    };

    const draw = () => {
      ctx.globalAlpha = 1;
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, width, height);

      const time = elapsedSec * FIELD_TIME_SCALE;

      for (const stroke of strokes) {
        const lifeProgress = strokeLifeProgress(
          time,
          STROKE_LIFE,
          stroke.lifePhase,
        );
        stampStroke(stroke, dabs[stroke.colorIndex], time, lifeProgress, 1, 1);
        // 縁は本体より少しだけ内側に。本体と同じ大きさで描くと輪が浮いて見える。
        //
        // 0.5 倍では blur を通したあと肉眼で読めなかった (実測: 5 枚とも
        // 縁がまったく見えず、境界が全部溶けていた)。濃さは本体並みに取る。
        if (stroke.rim) {
          stampStroke(
            stroke,
            rims[stroke.colorIndex],
            time,
            lifeProgress,
            0.95,
            1.15,
          );
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      rafId = window.requestAnimationFrame(tick);
      if (now - lastFrameAt < plan.frameIntervalMs) return;
      const deltaSec = lastTickAt === 0 ? 0 : (now - lastTickAt) / 1000;
      lastTickAt = now;
      lastFrameAt = now;
      // 復帰直後の大きな跳びを抑える (タブを 1 時間放置しても景色は飛ばない)。
      elapsedSec += Math.min(deltaSec, 1) * plan.timeScale;
      draw();
    };

    const stop = () => {
      if (!running) return;
      running = false;
      window.cancelAnimationFrame(rafId);
      rafId = 0;
      lastTickAt = 0;
    };

    const start = () => {
      if (running || !plan.animate) return;
      running = true;
      lastFrameAt = 0;
      lastTickAt = 0;
      rafId = window.requestAnimationFrame(tick);
    };

    const syncRunning = () => {
      if (plan.animate && visible && onScreen) start();
      else stop();
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      width = Math.max(MIN_RENDER_PX, Math.round(cssWidth * RENDER_SCALE));
      height = Math.max(MIN_RENDER_PX, Math.round(cssHeight * RENDER_SCALE));
      canvas.width = width;
      canvas.height = height;
      draw();
      if (grain && grainRef.current) {
        paintGrain(grainRef.current, cssWidth, cssHeight, seed + 4242);
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const onVisibility = () => {
      visible = !document.hidden;
      syncRunning();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      syncRunning();
    });
    intersectionObserver.observe(host);

    const motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const onMotionChange = (event: MediaQueryListEvent) => {
      plan.animate = !event.matches;
      if (!plan.animate) {
        stop();
        elapsedSec = 0;
        draw();
      } else {
        syncRunning();
      }
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    syncRunning();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener?.("change", onMotionChange);
    };
  }, [paletteKey, tempo, grain, seed, deposit]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        isolation: "isolate",
        // 不透明度は host に置く。canvas 側に置くと紙の粒子 (別 canvas) が
        // 素の濃さで残り、弱めるほど粒だけが目立つ面になる。
        opacity,
      }}
    >
      <canvas
        ref={washRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          filter: `blur(${BLUR_PX}px)`,
          transform: `scale(${OVERSCAN})`,
          transformOrigin: "center",
        }}
      />
      {grain ? (
        <canvas
          ref={grainRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}

export default SeasonalWash;
