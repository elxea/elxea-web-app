/**
 * 紙の繊維に近い粒子を作る純関数。
 *
 * ## v0 の粒子との違い
 * v0 は「全画素に一様な乱数で黒の透明度を置く」だけだった。これはフィルムの
 * ノイズであって紙ではない。実物の紙を見ると、粒は
 * - 濃さが場所によってムラになる (漉きムラ)
 * - 粒の大きさが揃っていない
 * - 暗い点だけでなく **明るい点** もある (繊維が光を返す)
 * - ときどき繊維が線として走る
 * という 4 つの不均質さを持つ。ここではその 4 つを足し合わせる。
 *
 * ## 出力
 * RGBA のバイト列 (タイル 1 枚分)。黒か白のどちらかを、透明度を変えて置く。
 * canvas の `createPattern` で敷き詰めるので、**継ぎ目が出ないこと** が要件。
 * 低周波のムラは格子を周期的に取ることでタイル境界をまたいで連続する。
 */

/** 決定的な擬似乱数 (mulberry32)。`flow-field` と同じ系列を使う。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 5 次のスムーズステップ。1 次補間だと格子が縞として見える。 */
function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 周期的なバリューノイズ。
 *
 * 格子点の値を `cells` 周期で巻き戻すので、タイルの右端と左端 (上端と下端) が
 * 必ず一致する = 敷き詰めても継ぎ目が出ない。
 *
 * @returns 0-1
 */
export function periodicValueNoise(
  cells: number,
  seed: number,
): (x: number, y: number) => number {
  const random = makeRandom(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();

  const at = (ix: number, iy: number) =>
    lattice[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];

  return (x, y) => {
    const fx = x * cells;
    const fy = y * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
    const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

export interface PaperGrainOptions {
  /** タイル一辺の画素数。 */
  size: number;
  seed: number;
  /** 粒のいちばん濃いところの透明度 (0-255)。 */
  intensity: number;
}

/**
 * 紙の粒子タイルを RGBA バイト列で返す。
 *
 * 手順:
 * 1. 低周波 (4 セル) のムラで **その場所の粒の濃さ** を決める
 * 2. 中周波 (16 セル) のムラを重ねて、濃淡の島を細かくする
 * 3. 1 画素ごとの細かい粒と、2x2 画素単位の粗い粒を混ぜる (粒径のばらつき)
 * 4. 符号で黒と白を振り分ける (繊維の陰と光)
 * 5. 最後に短い繊維の筋を数本走らせる
 */
export function paperGrainTile(options: PaperGrainOptions): Uint8ClampedArray {
  const { size, seed, intensity } = options;
  const data = new Uint8ClampedArray(size * size * 4);

  const blotch = periodicValueNoise(4, seed);
  const speckle = periodicValueNoise(16, seed + 977);
  const fine = makeRandom(seed + 1231);

  // 粗い粒は 2x2 画素で同じ値を使う。細かい粒と混ぜると粒径が揃わなくなる。
  const coarseSide = Math.ceil(size / 2);
  const coarse = new Float32Array(coarseSide * coarseSide);
  const coarseRandom = makeRandom(seed + 4441);
  for (let i = 0; i < coarse.length; i += 1) coarse[i] = coarseRandom();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;

      // その場所の粒の立ち方。0.28 を下限に置いて、ムラでも粒が消え切らないようにする。
      const amplitude =
        0.28 + 0.72 * (0.65 * blotch(u, v) + 0.35 * speckle(u, v));

      const fineValue = fine();
      const coarseValue =
        coarse[Math.floor(y / 2) * coarseSide + Math.floor(x / 2)];
      // -1..1。細かい粒と粗い粒をほぼ同じ重みで混ぜる。
      //
      // 粗い側を軽く (0.42 以下に) すると、粒がほぼ全部 1 画素になって「粒径の
      // ばらつき」が出ない (実測: 隣接画素の符号一致率が 0.58 = ほぼ白色雑音)。
      // ここを 0.48 まで上げると 0.64 前後になり、2 画素の塊が肉眼で混ざって見える。
      const mixed = (0.52 * fineValue + 0.48 * coarseValue - 0.5) * 2;

      const signed = mixed * amplitude;
      const index = (y * size + x) * 4;
      const dark = signed > 0;
      // 白い粒は黒より弱くする。紙は暗い点の方が目立つため。
      const weight = dark ? 1 : 0.62;
      const alpha = Math.abs(signed) * intensity * weight;

      data[index] = dark ? 0 : 255;
      data[index + 1] = dark ? 0 : 255;
      data[index + 2] = dark ? 0 : 255;
      data[index + 3] = alpha;
    }
  }

  drawFibers(data, size, seed + 7717, intensity);
  return data;
}

/**
 * 繊維の筋を走らせる。
 *
 * 1 画素幅の短い線を数十本。タイル境界は巻き戻して連続させる。粒だけだと
 * 「砂」に見えるが、方向を持った筋が少し混ざると紙に見える。
 */
function drawFibers(
  data: Uint8ClampedArray,
  size: number,
  seed: number,
  intensity: number,
): void {
  const random = makeRandom(seed);
  // 本数と濃さを絞る。強いと紙の繊維ではなく **レンズの傷** に見える
  // (実測: 10月昼で黒い破線がはっきり読めてしまった)。
  const count = Math.round((size * size) / 4200);

  for (let n = 0; n < count; n += 1) {
    const angle = random() * Math.PI * 2;
    const length = 5 + random() * 11;
    const dark = random() < 0.62;
    const strength = (0.16 + random() * 0.2) * intensity;
    let x = random() * size;
    let y = random() * size;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    for (let step = 0; step < length; step += 1) {
      const px = ((Math.round(x) % size) + size) % size;
      const py = ((Math.round(y) % size) + size) % size;
      const index = (py * size + px) * 4;
      // 端を弱める。切り口が点として見えないようにする。
      const taper = Math.sin((Math.PI * step) / length);
      const alpha = data[index + 3] + strength * taper;
      data[index] = dark ? 0 : 255;
      data[index + 1] = dark ? 0 : 255;
      data[index + 2] = dark ? 0 : 255;
      data[index + 3] = alpha;
      x += dx;
      y += dy;
    }
  }
}
