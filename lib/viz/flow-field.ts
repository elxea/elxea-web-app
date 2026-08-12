/**
 * にじみの「流れ」を決める純関数。
 *
 * ## なぜ v1 でこれが要るか
 * v0 の面は同心円の radial gradient を数枚重ねただけで、絵として見ると
 * **ぼかした写真** にしかならなかった。塊が等方 (どの方向にも同じ形) なので、
 * 画面のどこを見ても「中心から外へ薄くなる」という同じ出来事しか起きない。
 *
 * 絵画に見える面には **方向** がある。色が流れていく向きが画面全体で緩やかに
 * 揃っていて、その流れに沿って色が引き伸ばされ、流れが出会うところで色と色が
 * ぶつかる。ここではその「向き」だけを持つ場 (フローフィールド) を定義し、
 * 塊をその場に沿って走らせる経路 (ストローク) を作る。
 *
 * ## 描画から切り離してある理由
 * canvas はブラウザでしか動かないが、**流れが破綻していないか** はブラウザ無しで
 * 検査できる。経路が画面外へ飛ばないか、場が滑らかか (隣り合う点の向きが跳ばないか)、
 * 同じ seed で同じ絵になるかは、すべてここで機械的に守る。
 *
 * ## 乱数について
 * `Math.random` は使わない。seed から決定的に生成するので、SSR とクライアントで
 * ずれず、スクリーンショットも毎回同じになる。
 */

const TAU = Math.PI * 2;

/** 決定的な擬似乱数 (mulberry32)。seed が同じなら必ず同じ列を返す。 */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FlowFieldOptions {
  /** 全体の流れの向き (ラジアン)。画面に一本の大きな方向を与える。 */
  baseAngle: number;
  /**
   * 蛇行の強さ (ラジアン)。0 だと全ストロークが平行に走って **工業的** になる。
   * 大きすぎると渦になって「にじみ」ではなく「マーブル模様」になる。
   */
  turn: number;
  seed: number;
}

/** 座標 (0-1) と時刻 (秒) から流れの向き (ラジアン) を返す関数。 */
export type FlowField = (x: number, y: number, t: number) => number;

/**
 * 三つの低周波な正弦波を重ねて向きの場を作る。
 *
 * 周波数を無理数比に近く取り、位相を seed から散らすことで、繰り返しの見える
 * 格子模様にならないようにしている。時間項の係数を周波数ごとに変えているのは、
 * 場全体が一様に回転するのではなく **形を変えながらゆっくり流れる** ため。
 */
export function makeFlowField(options: FlowFieldOptions): FlowField {
  const random = makeRandom(options.seed);
  const waves = [
    { fx: 0.9, fy: 0.55, amp: 0.62, speed: 0.17, phase: random() * TAU },
    { fx: -0.7, fy: 1.3, amp: 0.3, speed: 0.11, phase: random() * TAU },
    { fx: 1.9, fy: -1.1, amp: 0.18, speed: 0.23, phase: random() * TAU },
  ];
  // 振幅の合計で割って、turn がそのまま最大振れ幅 (ラジアン) になるようにする。
  const norm = waves.reduce((sum, w) => sum + w.amp, 0);

  return (x, y, t) => {
    let sum = 0;
    for (const w of waves) {
      sum += w.amp * Math.sin((x * w.fx + y * w.fy) * TAU + t * w.speed + w.phase);
    }
    return options.baseAngle + (options.turn * sum) / norm;
  };
}

export interface StrokeSeed {
  /** パレット上の色の添字。 */
  colorIndex: number;
  /** 種の位置 (0-1)。実際の起点は時間とともにこの点から流れる。 */
  x: number;
  y: number;
  /** 経路の長さ (画面の高さに対する比)。 */
  length: number;
  /** 筆の太さ (画面の高さに対する比)。 */
  width: number;
  /**
   * 流れ方向への引き伸ばし比。1 で円、大きいほど細長い滲みになる。
   *
   * **1 に近い値でよい。** 細長さは経路が担うのであって、スタンプが担うのではない。
   * ここを上げると `dabToPathRatio` が悪化し、スタンプ 1 枚の楕円がそのまま輪郭に
   * なる (実測: 1.45〜2.2 で 10月昼の金茶と 8月朝の緑が、縁の立ったレンズ形の
   * 図形になった)。1 ちょうどにしないのは、隣り合う粒が流れ方向で少し重なった方が
   * union が滑らかにつながるため。
   */
  elongation: number;
  /** 1 スタンプあたりの濃さ。重ね塗りで積み上がるので低く取る。 */
  alpha: number;
  /** 一生のあいだに流れて行く距離 (画面の高さに対する比)。 */
  travel: number;
  /** 一生の中でのずれ (0-1)。本ごとにずらして、同時に現れ / 消えないようにする。 */
  lifePhase: number;
  /**
   * 場の向きからのずれ (ラジアン)。本ごとに少しずつ違う向きへ走らせる。
   *
   * 0 にすると全ストロークが同じ流線に乗って 1 本の帯に融合する。ここが
   * 「流れはあるが、色どうしがぶつかる」を成立させている。
   */
  angleBias: number;
  /** にじみの縁 (色が出会うところの濃度差) を描くか。 */
  rim: boolean;
}

export interface StrokePlanOptions {
  /** 色ごとの本数の重み。面積配分をここで決める。 */
  weights: number[];
  /** 総本数。多すぎると筆致が数えられて工業的になる。 */
  count: number;
  seed: number;
  /**
   * 種を置く位置の全体的なずらし (0-1 座標)。
   *
   * ストロークは一生をかけて流れの下流へ移動するので、種を画面の中央に均等に
   * 置くと **時間で均した密度が下流に偏る**。実測では 5 枚すべてで左下が地の
   * まま残り、右上に色が寄った。ここに「流れの逆向き・移動量の半分」を渡して
   * 上流へずらしておくと、いちばん濃く出る一生の半ばで画面の中央に来る。
   */
  originShift?: { x: number; y: number };
  /**
   * 種を流れ方向に散らす幅 (0-1 座標)。本ごとに ±半分だけずらす。
   *
   * `strokeEnvelope` は経路の両端で濃さを 0 にする。経路を長くすると、この
   * 「薄い端」も長くなり、**濃く出るのは各ストロークの中ほど 6 割だけ** になる。
   * 全ストロークを同じ量だけ上流へ戻すと、その中ほどが一斉に同じ場所へ来て、
   * 画面に 1 本の太い尾根ができる (実測: 経路を 0.73 -> 1.45 に伸ばしたら、
   * 右下に帯が寄って左上 4 割が地のまま残った)。
   *
   * ここに経路長と同程度の幅を渡して開始点を流れ方向へばらけさせると、濃い
   * 部分が重ならず画面全体に散る。流れの向きは呼び出し側しか知らないので、
   * ベクトルとして受け取る。
   */
  originJitter?: { x: number; y: number };
}

/** 種を置く範囲。画面の外まで広げて、外から流れ込んでくる分を作る。 */
const SEED_MARGIN = 0.18;

/**
 * 経路を何点に刻むか。
 *
 * 描画側ではなくここに置いてある。刻みの細かさは「経路をどう辿るか」の性質であって
 * 描画の都合ではないし、下の `dabToPathRatio` と合わせて **1 点を何枚のスタンプが
 * 覆うか** を機械的に検査したいため (`STROKE_STEPS` が描画側にあると検査できない)。
 */
export const STROKE_STEPS = 40;

/**
 * スタンプ 1 枚の長さが経路全体に占める割合。
 *
 * ## なぜこの比を測るのか (v1 の不具合の正体)
 * 10月昼の金茶が **輪郭のはっきりした楕円** として画面に貼りついていた。原因を
 * 「スタンプが前進量より長すぎる」と見立てたが、実測するとそれは外れていた。
 * 前進量に対する重なりは平均 9 枚あり、むしろ十分だった。
 *
 * 本当の原因はもう一段上の比で、**スタンプ 1 枚が経路そのものと同じ長さだった**
 * こと (実測: 平均 0.60、最悪 1.21 = 経路よりスタンプの方が長い)。この状態では
 * 何枚重ねても union は 1 枚の楕円のままで、経路に沿って伸びない。重なり枚数を
 * いくら増やしても直らない。
 *
 * ## 何を守れば「にじみの帯」になるか
 * - この比を小さく保つ (目安 0.2 以下)。小さな粒が経路に沿って並んで初めて、
 *   union がスタンプではなく **経路の形** になる。
 * - ただし比 x `STROKE_STEPS` = 1 点を覆う枚数が 3 を切ると、今度は粒が数えられて
 *   点線になる。両方を同時に満たす必要がある。
 *
 * 引き伸ばし (`elongation`) を上げて細長さを稼ぐのは、この比を悪化させる方向。
 * 細長さは **経路** が担い、スタンプは丸に近いままでよい。
 */
export function dabToPathRatio(seed: StrokeSeed): number {
  // 描画側: radius = width*h/2、流れ方向の半径は radius*elongation。
  // よってスタンプ全長 = width*elongation (h 単位)、経路長 = length (h 単位)。
  return (seed.width * seed.elongation) / seed.length;
}

/**
 * ストロークの種を作る。
 *
 * ## 面積配分
 * `weights` は色ごとの本数の重み。地の色は本数を減らして (下地として広く塗るのは
 * canvas の塗りつぶしの役目)、主役の色は本数を増やさずに **太さと濃さ** を上げる。
 * 「面積が広い = 目立つ」ではないので、狭い面積に濃い色を置く方が絵は締まる。
 *
 * ## 位置 — 螺旋をやめて格子にした理由
 * 最初は中心から外への黄金角の螺旋で置いていた。実物を撮ると **画面の右上に
 * 三日月が 1 本できるだけで、左半分が地のまま** になった。原因は 2 つあって、
 * (1) 螺旋は中心付近に密で周辺が薄い、(2) すべての種が同じ向きへ流れるので、
 * 位相が違っても結局 **同じ流線の上に並ぶ**。
 *
 * そこで、画面より一回り広い範囲を格子に割り、各マスの中でゆらして 1 本ずつ置く。
 * 格子は被覆が保証され、ゆらぎで格子らしさが消える。色は先に本数を決めてから
 * 決定的にシャッフルして配るので、同じ色が一箇所に固まらない。
 *
 * ## 向きのばらつき
 * 全ストロークが場の向きそのままだと、束になって 1 本の帯に融合する
 * (実測: 5 枚すべてが「1 本の三日月」になった)。`angleBias` で本ごとに少しずつ
 * 向きをずらすと、流れの大局は保ったまま、ストロークどうしが交差して
 * **色と色がぶつかる境界** が生まれる。
 */
export function buildStrokeSeeds(options: StrokePlanOptions): StrokeSeed[] {
  const { weights, count, seed } = options;
  const random = makeRandom(seed);
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);

  // 重みを本数へ配る。端数は大きい重みから順に拾う。
  const quotas = weights.map((w) => (Math.max(0, w) / total) * count);
  const counts = quotas.map((q) => Math.floor(q));
  let remaining = count - counts.reduce((sum, n) => sum + n, 0);
  const order = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac);
  for (const entry of order) {
    if (remaining <= 0) break;
    counts[entry.i] += 1;
    remaining -= 1;
  }

  // 色の並びを作ってから決定的にシャッフルする。並びのまま格子へ配ると、
  // 同じ色が画面の一角に固まる。
  const colorOrder: number[] = [];
  counts.forEach((n, colorIndex) => {
    for (let i = 0; i < n; i += 1) colorOrder.push(colorIndex);
  });
  for (let i = colorOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [colorOrder[i], colorOrder[j]] = [colorOrder[j], colorOrder[i]];
  }

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const span = 1 + SEED_MARGIN * 2;
  const cellW = span / cols;
  const cellH = span / rows;
  const golden = 2.399963229728653; // 黄金角 (ラジアン)

  const shift = options.originShift ?? { x: 0, y: 0 };
  const jitter = options.originJitter ?? { x: 0, y: 0 };

  return colorOrder.map((colorIndex, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    // 流れ方向へのずらしは 1 本につき 1 個の乱数で決める (x と y で別々に引くと
    // 流れ方向ではなく斜めに散ってしまう)。
    const along = random() - 0.5;
    return {
      colorIndex,
      // マスの中心からマス幅の 4 割まで動かす。動かしすぎるとまた偏る。
      x:
        -SEED_MARGIN +
        (col + 0.5) * cellW +
        (random() - 0.5) * cellW * 0.8 +
        shift.x +
        along * jitter.x,
      y:
        -SEED_MARGIN +
        (row + 0.5) * cellH +
        (random() - 0.5) * cellH * 0.8 +
        shift.y +
        along * jitter.y,
      // 経路は画面を横切る長さを取る。ここが短いとスタンプ 1 枚に対して経路が
      // 短すぎ、union が楕円のまま出る (`dabToPathRatio` 参照)。
      //
      // ばらつきを広く取らないのは、`dabToPathRatio` と「1 点を覆う枚数」が
      // 3 つの乱数の積と商で決まるため。幅を広げると最悪ケースだけが両条件の
      // どちらかを踏み抜く (実測: 幅を広く取ったとき最小の重なりが 2.0 枚まで落ち、
      // 粒が数えられる側に振れた)。
      length: 1.2 + random() * 0.5,
      // 筆は細くする。太い筆 + 短い経路が「錠剤形の図形」の正体だった。
      width: 0.105 + random() * 0.05,
      elongation: 1.12 + random() * 0.26,
      // 細い筆に変えたぶん 1 本あたりの塗り面積が減ったので、1 スタンプの濃さは
      // 上げる。ここを上げずに本数だけ増やすと、明るい配色が無地のオフホワイトと
      // 見分けの付かない霞になる (実測: 8月朝・10月昼)。
      alpha: 0.15 + random() * 0.07,
      travel: 0.25 + random() * 0.35,
      angleBias: (random() - 0.5) * 0.72,
      // 一生を等間隔にずらす。まとめてずらすと全部が同時に薄くなり、
      // 面が呼吸しているように見えてしまう。
      lifePhase: (index * golden) / TAU - Math.floor((index * golden) / TAU),
      // 縁は全部には付けない。全ストロークに付けると輪郭が数えられて
      // 「絵筆で描いた」に寄る。本数を増やした分、割合は 1/2 から 1/3 に落とす
      // (縁の総量を v1 初版と同じくらいに保つ)。
      rim: index % 3 === 1,
    };
  });
}

export interface StrokePoint {
  /** 0-1 の座標。画面外へ出る値も返す (呼び出し側が縁の外まで塗るため)。 */
  x: number;
  y: number;
  /** その点での流れの向き (ラジアン)。 */
  angle: number;
  /** 経路上の位置 (0 = 始点, 1 = 終点)。 */
  progress: number;
}

export interface TraceOptions {
  /** 画面の縦横比 (width / height)。向きを歪ませないために要る。 */
  aspect: number;
  /** 分割数。多いほど滑らかだが重い。 */
  steps: number;
  /** 場の変形に使う時刻。 */
  time: number;
  /** このストロークの一生の進み具合 (0-1)。出発点の移動量に効く。 */
  lifeProgress: number;
}

/** 出発点を流れに沿って送るときの積分ステップ数。 */
const DRIFT_STEPS = 4;

/**
 * 種を流れに沿って走らせ、経路の点列を返す。
 *
 * 前進の刻みは `length / steps`。各点で場をサンプルし直すので、経路は場の
 * 蛇行に沿って曲がる。座標は 0-1 で扱うが、画面が横長のとき x 方向 1 は
 * y 方向 1 より長い。向きを保つため x の移動量を `aspect` で割っている
 * (これをやらないと横長画面で流れが寝てしまう)。
 *
 * ## 出発点も流れる
 * 種そのものが一生をかけて `travel` だけ流れる。これがないと場が変形するだけで
 * 塊が同じ場所に居座り、v0 と同じ「その場で息をする円」に戻る。
 *
 * 移動を 0-1 で巻き戻さず、一生の終わりで元の位置へ戻すのは、巻き戻すと画面の
 * 端から端へ **瞬間移動して見える** ため。消えている間に戻す (`strokeLifeEnvelope`)。
 */
export function traceStroke(
  field: FlowField,
  seed: StrokeSeed,
  options: TraceOptions,
): StrokePoint[] {
  // 出発点を流れに沿って送る。直線ではなく場に沿わせたいので数回に分けて積分する。
  const driftStep = (seed.travel * options.lifeProgress) / DRIFT_STEPS;
  let x = seed.x;
  let y = seed.y;
  for (let i = 0; i < DRIFT_STEPS; i += 1) {
    const angle = field(x, y, options.time) + seed.angleBias;
    x += (Math.cos(angle) * driftStep) / options.aspect;
    y += Math.sin(angle) * driftStep;
  }

  const step = seed.length / options.steps;
  const points: StrokePoint[] = [];
  for (let i = 0; i <= options.steps; i += 1) {
    const angle = field(x, y, options.time) + seed.angleBias;
    points.push({ x, y, angle, progress: i / options.steps });
    x += (Math.cos(angle) * step) / options.aspect;
    y += Math.sin(angle) * step;
  }
  return points;
}

/**
 * 一生の進み具合 (0-1)。`period` ごとに 0 へ戻る。
 *
 * 戻る瞬間に位置が跳ぶが、`strokeLifeEnvelope` がそこで濃さを 0 にするので
 * 画面上では見えない。
 */
export function strokeLifeProgress(
  time: number,
  period: number,
  phase: number,
): number {
  const raw = time / period + phase;
  return raw - Math.floor(raw);
}

/**
 * 一生を通じてどれくらい濃く出るかの倍率。
 *
 * 1 だと sin の山そのままで、平均すると 0.64 しか出ない = 常に 3 割強の
 * ストロークが薄い状態になり、画面に空白ができる (実測: 16 本に増やしても
 * 面の半分が地のまま残った)。1 を超える値で頭打ちさせると、生死の瞬間だけ
 * 素早く消えて、あいだは満量で出る。
 */
const LIFE_PLATEAU = 1.7;

/**
 * 一生の濃さの包絡線。生まれるときと消えるときにゼロを通る。
 *
 * `strokeEnvelope` (経路の両端) と掛け合わせて使う。役割が違うので分けてある:
 * こちらは **時間** の端、あちらは **経路** の端。
 */
export function strokeLifeEnvelope(lifeProgress: number): number {
  const clamped = Math.min(1, Math.max(0, lifeProgress));
  return Math.min(1, Math.sin(Math.PI * clamped) * LIFE_PLATEAU);
}

/**
 * 経路上の濃さの包絡線。
 *
 * 両端をゼロに落とすことで、ストロークの端が **切り口として見えない** ようにする。
 * これがないと線の始点と終点が丸く途切れ、「にじみ」ではなく「筆で引いた線」に
 * なる。sin 半周期は端で滑らかにゼロへ入るのでこの用途に合う。
 */
export function strokeEnvelope(progress: number): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
}

/**
 * 経路に沿った濃さのむら。`depth` が大きいほど **切れ目** ができる。
 *
 * ## なぜ切れ目が要るか (v1-fix の失敗の正体)
 * v1-fix は 1 本の主役ストロークが「太さも濃さも全長で一定のリボン」として
 * 読めた (実測: 10月昼の金茶・8月朝の緑)。楕円ではなくなったが、**輪郭を目で
 * 追える連続した図形** であることは変わっていない。
 *
 * 面が「にじみ」に見えるのは、濃いところと消えるところが長さ方向に散っていて、
 * どこからどこまでが 1 本なのか **数えられない** ときだけ。だから濃度は
 * 「一定 x ゆらぎ」ではなく、**ゼロを通る** 必要がある。
 *
 * ## 低い depth では v1 の式と完全に一致する
 * 地と中間色の置き方 (淡い面としてゆるく重なる) は既に成立しているので、
 * 触らない。`depth <= 0.3` では `1 - depth + depth * sin(...)` そのままで、
 * depth = 0.26 は v1 の `0.74 + 0.26 sin(progress * 7.3 + phase)` と同一。
 * 細かい波が混ざるのは主役に使う高い depth のときだけ。
 */
export function pathDensity(
  progress: number,
  phase: number,
  depth: number,
): number {
  const primary = Math.sin(progress * 7.3 + phase);
  const detail =
    Math.sin(progress * 13.1 - phase * 1.7) * 0.62 +
    Math.sin(progress * 21.7 + phase * 0.61) * 0.38;
  const blend = Math.max(0, (depth - 0.3) / 0.7);
  const wave = primary * (1 - 0.5 * blend) + detail * 0.78 * blend;
  return Math.max(0, Math.min(1.2, 1 - depth + depth * wave));
}

/**
 * 経路の中心線を流れと直交する向きへずらす量 (-1 〜 1、筆の半径を単位とする)。
 *
 * ストロークは `traceStroke` の点列を **そのまま** 中心線にすると、流線に沿った
 * きれいな管になる。管は太さが揃っていて輪郭を追えるので図形に見える。中心線を
 * 低周波でゆらすと、同じ流れに乗ったままシルエットだけが崩れ、隣の本と食い違って
 * 重なる = 面になる。
 *
 * 乱数ではなく progress の関数にしてあるのは、フレーム間で形が跳ばないため
 * (毎フレーム引き直すとちらつく)。
 */
export function lateralDrift(progress: number, phase: number): number {
  return (
    Math.sin(progress * 4.1 + phase * 1.3) * 0.6 +
    Math.sin(progress * 9.7 - phase * 0.83) * 0.4
  );
}

/**
 * スタンプ 1 枚ごとの半径倍率。
 *
 * 全部を同じ半径で置くと、union の縁が中心線から等距離の包絡線になる = 縁が
 * 均質な帯になる。大小を混ぜると縁が場所ごとに出入りして、**どこが端なのか
 * 決められない** 形になる。
 */
export function dabScatter(progress: number, phase: number): number {
  const wave =
    Math.sin(progress * 5.9 + phase * 2.1) * 0.6 +
    Math.sin(progress * 11.3 + phase) * 0.4;
  return 1 + 0.5 * wave;
}
