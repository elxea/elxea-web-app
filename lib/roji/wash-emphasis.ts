/**
 * 配色の明るさから「色をどれだけ点らせるか」を決める純関数。
 *
 * ## なぜ配色ごとに変える必要があるか (v2 の後退の正体)
 * v2 は主役の色を「細く濃い線」から「広く薄い面」へ置き換えて、10月昼の金茶が
 * 錠剤形の図形に見える問題を解いた。ところがその弱め方 (濃度を 1/3.5、幅を 2.2 倍、
 * 横ゆれと切れ目を強く) を **全配色へ一律に適用した** ため、夜の配色が壊れた。
 * 実測: 12月夜が v1 では「深い藍に青緑と銅色が点る」画だったのが、v2 では
 * ほぼ均一な紺に淡い横縞が残るだけになった。
 *
 * 原因は、同じ濃度でも **地の明るさによって色の読まれ方が逆になる** ことにある。
 *
 * - **明るい地** — 主役は紙に落ちた「染み」として読まれる。地との明度差が
 *   そのまま輪郭になるので、濃いと図形化する。広く・薄く・散らすのが正しい
 * - **暗い地** — 主役は暗がりの中の「光」として読まれる。光は輪郭ではなく
 *   中心の輝きで認識されるので、濃くても図形になりにくい。むしろ薄いと
 *   地の暗さに沈んで色そのものが消える
 *
 * v0 の実装者も同じ結論に到達していた (記録:「The right rule is palette-dependent:
 * light palettes want a paper ground, dark ones want depth.」)。このモジュールは
 * その原則を暗黙の調整ではなく **式** として置く。
 *
 * ## 描画から切り離してある理由
 * canvas はブラウザでしか動かないが、「暗い配色ほど濃く・狭く・まとまって出る」が
 * 守られているかはブラウザ無しで検査できる。係数が単調か、両端で意図した値に
 * なるか、境界の外へ飛ばないかは、すべてここで機械的に守る。
 */

import { hexToOklch } from "./color";

/**
 * 主役 (と中間色) の置き方を決める係数。
 *
 * すべて `ROLE_STYLE` の基準値に対する倍率で、描画側の `SeasonalWash` が
 * ストロークの種へ掛ける。単位を持たないのは、値そのものではなく
 * **明るい配色と暗い配色の差** がこのモジュールの責務だから。
 */
export interface WashEmphasis {
  /** 主役の本数の重み。大きいほど重なりで出す (1 本の存在感に頼らない)。 */
  weight: number;
  /** 主役の筆の太さ倍率。大きいほど線ではなく面になる。 */
  width: number;
  /** 主役 1 スタンプの濃さ倍率。暗い地ではここを大きく取る。 */
  alpha: number;
  /** 主役の流れ方向への引き伸ばし倍率。 */
  elongation: number;
  /** 主役の長さ方向の濃度むらの深さ。大きいほど途中で消える。 */
  mottleDepth: number;
  /** 主役の中心線の横ゆれ幅 (筆の半径を単位とする)。0 で管のまま。 */
  spread: number;
  /**
   * 中間色の濃さ倍率。
   *
   * 主役だけを扱えば足りるはずだったが、12月夜で「点る」対象は銅色 (主役) と
   * 青緑 (中間色) の 2 つで、青緑が沈むと画面は紺一色になる。暗い地では
   * 中間色も光の側に回るので、ここも一緒に押し上げる。
   */
  midAlpha: number;
  /**
   * 中間色の中心線の横ゆれ幅。
   *
   * 中間色は既定で「横ゆれ無し + 縁あり」= 太さの揃った管として置かれる。
   * 明るい地ではこれで問題ない (10月昼は合格) が、暗い地では地との明度差が
   * 大きいぶん管の輪郭がそのまま読めてしまい、**濃さを上げるほど帯になる**。
   * 暗い配色では中間色も散らして面に戻す。
   */
  midSpread: number;
  /** 中間色の長さ方向の切れ目。暗い配色では深くして連続した帯を断つ。 */
  midMottleDepth: number;
}

/**
 * これを超える横ゆれが掛かった中間色からは縁を落とす閾値。
 *
 * 縁 (`rim`) は全長にわたる均質な輪郭そのものなので、散らして面にしたい層に
 * 重ねると打ち消し合う。連続値の `midSpread` から二値の「縁を描くか」を決める
 * 必要があるためここで切る。夕 (横ゆれ 0.09 相当) は実質ゆれていないので
 * 閾値の下に置き、縁を保ったまま v2 と同じ見え方にする。
 */
export const MID_RIM_SPREAD_LIMIT = 0.15;

/**
 * 暗い配色 (夜) の置き方。
 *
 * v1 の夜 (濃度 3.5 倍相当・幅 1/2.2・横ゆれ無し・切れ目浅め) と v2 の面化の
 * 中間を取ってある。v1 そのままに戻さないのは、v1 は明るい配色で連続したリボンに
 * なる置き方であり、暗い配色でも「輪郭を追える図形が無い」ことは要件だから。
 * 横ゆれと切れ目は残したまま、濃度と幅だけを光の側へ寄せる。
 *
 * ## 濃度をどこまで上げてよいか (実測で決めた上限)
 * 最初に濃度 3.0 / 幅 1.15 / 横ゆれ 0.8 / 切れ目 0.55 を試して捨てた。12月夜で
 * 銅色が **画面を横切る太い連続した帯** になり、v1 のリボン問題がそのまま再発した
 * (実測: /tmp/seasonal-wash-v3 の 1 回目)。暗い地でも、濃度を上げると同時に幅と
 * 散らしを絞れば輪郭は立つ。暗い地で効くのは「濃度を上げること」であって
 * 「まとめること」ではない。よって濃度は明るい側の 1.8 倍に留め、幅・横ゆれ・
 * 切れ目は明るい側から大きくは落とさない。
 */
const DARK_EMPHASIS: WashEmphasis = {
  weight: 1.9,
  width: 1.45,
  alpha: 1.9,
  elongation: 0.78,
  mottleDepth: 0.88,
  spread: 1.3,
  midAlpha: 1.75,
  midSpread: 0.9,
  midMottleDepth: 0.6,
};

/**
 * 明るい配色 (朝・昼) の置き方。
 *
 * v2 の値そのまま。10月昼で「硬いリボンが消えて地に溶けた斜めの流れになった」
 * ことが実物で確認できている合格点なので、ここは動かさない。
 */
const LIGHT_EMPHASIS: WashEmphasis = {
  weight: 2,
  width: 1.7,
  alpha: 1.05,
  elongation: 0.72,
  mottleDepth: 0.95,
  spread: 1.4,
  midAlpha: 1,
  midSpread: 0,
  midMottleDepth: 0.26,
};

/**
 * 完全に「暗い配色」と見なす平均明度。これ以下は `DARK_EMPHASIS` そのまま。
 *
 * 実測値: 8月夜 0.465 / 12月夜 0.461。夜の配色はここより十分下にある。
 */
export const DARK_PALETTE_PIVOT = 0.5;

/**
 * 完全に「明るい配色」と見なす平均明度。これ以上は `LIGHT_EMPHASIS` そのまま。
 *
 * 実測値: 10月昼 0.838 / 8月朝 0.880。夕 (9月 0.724) は境目の内側に入り、
 * 明るい側へ 9 割ほど寄った中間の置き方になる。夕は地が沈み始める時間帯なので、
 * 昼と夜のどちらかに倒すのではなく連続的に移るのが正しい。
 */
export const LIGHT_PALETTE_PIVOT = 0.78;

/** 0-1 を両端で滑らかに詰めた補間係数にする。境目で係数が跳ばないようにする。 */
function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 配色の平均明度 (OKLCH の L)。
 *
 * 地の明度だけを見ないのは、地が 1 色でも残り 3 色が明るければ画面全体は
 * 明るく読まれるため。解釈できない色は中明度 (0.5) として数え、例外を投げない
 * (任意のパレットを渡されても面は描けなければならない)。
 */
export function paletteMeanLightness(colors: string[]): number {
  if (colors.length === 0) return 0.5;
  const sum = colors.reduce((acc, hex) => {
    try {
      return acc + hexToOklch(hex).l;
    } catch {
      return acc + 0.5;
    }
  }, 0);
  return sum / colors.length;
}

/**
 * 平均明度 -> 置き方の係数。
 *
 * 暗い側から明るい側へ単調に「濃く狭くまとまった光」から「薄く広く散った染み」
 * へ移る。閾値で切り替えず補間するのは、月と時間帯の 48 通りが連続的に変化する
 * 以上、係数も連続でなければ隣り合う時間帯で絵が跳ぶため。
 */
export function washEmphasisFor(meanLightness: number): WashEmphasis {
  const t = smoothstep(
    (meanLightness - DARK_PALETTE_PIVOT) /
      (LIGHT_PALETTE_PIVOT - DARK_PALETTE_PIVOT),
  );
  return {
    weight: lerp(DARK_EMPHASIS.weight, LIGHT_EMPHASIS.weight, t),
    width: lerp(DARK_EMPHASIS.width, LIGHT_EMPHASIS.width, t),
    alpha: lerp(DARK_EMPHASIS.alpha, LIGHT_EMPHASIS.alpha, t),
    elongation: lerp(DARK_EMPHASIS.elongation, LIGHT_EMPHASIS.elongation, t),
    mottleDepth: lerp(DARK_EMPHASIS.mottleDepth, LIGHT_EMPHASIS.mottleDepth, t),
    spread: lerp(DARK_EMPHASIS.spread, LIGHT_EMPHASIS.spread, t),
    midAlpha: lerp(DARK_EMPHASIS.midAlpha, LIGHT_EMPHASIS.midAlpha, t),
    midSpread: lerp(DARK_EMPHASIS.midSpread, LIGHT_EMPHASIS.midSpread, t),
    midMottleDepth: lerp(
      DARK_EMPHASIS.midMottleDepth,
      LIGHT_EMPHASIS.midMottleDepth,
      t,
    ),
  };
}

/** パレットから直接。描画側はこれだけ呼べばよい。 */
export function washEmphasisForPalette(colors: string[]): WashEmphasis {
  return washEmphasisFor(paletteMeanLightness(colors));
}
