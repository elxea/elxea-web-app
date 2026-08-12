import { describe, expect, it } from "vitest";

import {
  buildStrokeSeeds,
  dabScatter,
  dabToPathRatio,
  lateralDrift,
  makeFlowField,
  makeRandom,
  pathDensity,
  strokeEnvelope,
  strokeLifeEnvelope,
  strokeLifeProgress,
  traceStroke,
  STROKE_STEPS,
  type FlowField,
  type StrokeSeed,
} from "@/lib/viz/flow-field";

const FIELD = { baseAngle: -0.38, turn: 0.85, seed: 1 };

describe("makeRandom", () => {
  it("returns the same sequence for the same seed", () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    const left = Array.from({ length: 20 }, () => a());
    const right = Array.from({ length: 20 }, () => b());
    expect(left).toEqual(right);
  });

  it("returns a different sequence for a different seed", () => {
    const a = makeRandom(7);
    const b = makeRandom(8);
    expect(a()).not.toBe(b());
  });

  it("stays inside [0, 1)", () => {
    const random = makeRandom(99);
    for (let i = 0; i < 2000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("makeFlowField", () => {
  const field = makeFlowField(FIELD);

  it("is deterministic for the same seed", () => {
    const other = makeFlowField(FIELD);
    for (const [x, y, t] of [
      [0.1, 0.2, 0],
      [0.7, 0.4, 12],
      [0.9, 0.95, 40],
    ]) {
      expect(field(x, y, t)).toBe(other(x, y, t));
    }
  });

  /**
   * 場が滑らかでないと、隣り合うスタンプの向きが跳んで、にじみではなく
   * ぎざぎざの帯になる。近い 2 点の向きの差が小さいことを機械的に守る。
   */
  it("is smooth: nearby points have nearby directions", () => {
    const step = 0.01;
    let worst = 0;
    for (let x = 0; x <= 1; x += 0.05) {
      for (let y = 0; y <= 1; y += 0.05) {
        const here = field(x, y, 3);
        worst = Math.max(
          worst,
          Math.abs(field(x + step, y, 3) - here),
          Math.abs(field(x, y + step, 3) - here),
        );
      }
    }
    // 0.01 動いて 0.1 ラジアン (約 6 度) 以上曲がるようなら急すぎる。
    expect(worst).toBeLessThan(0.1);
  });

  /**
   * 全体の向きが揃っていること。揃っていないと画面が渦だらけになり、
   * 「方向性のある流れ」ではなくマーブル模様になる。
   */
  it("keeps a dominant direction across the frame", () => {
    let sumX = 0;
    let sumY = 0;
    let samples = 0;
    for (let x = 0; x <= 1; x += 0.05) {
      for (let y = 0; y <= 1; y += 0.05) {
        const angle = field(x, y, 5);
        sumX += Math.cos(angle);
        sumY += Math.sin(angle);
        samples += 1;
      }
    }
    // 平均ベクトルの長さ。1 なら完全に平行、0 なら向きがばらばら。
    const coherence = Math.hypot(sumX, sumY) / samples;
    expect(coherence).toBeGreaterThan(0.5);
    // ただし完全な平行 (工業的) でもない。
    expect(coherence).toBeLessThan(0.99);
  });

  it("stays within the declared turn of the base angle", () => {
    for (let x = 0; x <= 1; x += 0.02) {
      for (let y = 0; y <= 1; y += 0.02) {
        for (const t of [0, 17, 55]) {
          const deviation = Math.abs(field(x, y, t) - FIELD.baseAngle);
          expect(deviation).toBeLessThanOrEqual(FIELD.turn + 1e-9);
        }
      }
    }
  });

  it("changes over time", () => {
    expect(field(0.5, 0.5, 0)).not.toBe(field(0.5, 0.5, 30));
  });
});

describe("buildStrokeSeeds", () => {
  it("produces exactly the requested count", () => {
    for (const count of [4, 7, 9, 12]) {
      const seeds = buildStrokeSeeds({
        weights: [1, 1.2, 1.5, 1.5],
        count,
        seed: 3,
      });
      expect(seeds).toHaveLength(count);
    }
  });

  /** 面積配分。重みの大きい色の方が本数が多いこと。 */
  it("allocates more strokes to heavier weights", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1.2, 1.5, 1.5],
      count: 9,
      seed: 3,
    });
    const perColor = [0, 1, 2, 3].map(
      (i) => seeds.filter((s) => s.colorIndex === i).length,
    );
    expect(perColor[3]).toBeGreaterThanOrEqual(perColor[0]);
    expect(perColor.every((n) => n >= 1)).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const options = { weights: [1, 1, 1, 1], count: 9, seed: 42 };
    expect(buildStrokeSeeds(options)).toEqual(buildStrokeSeeds(options));
  });

  it("varies with the seed", () => {
    const a = buildStrokeSeeds({ weights: [1, 1, 1, 1], count: 9, seed: 1 });
    const b = buildStrokeSeeds({ weights: [1, 1, 1, 1], count: 9, seed: 2 });
    expect(a).not.toEqual(b);
  });

  /** 種が画面の外や角に固まると、面の半分が地のままになる。 */
  it("scatters the seeds across the frame", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 9,
      seed: 5,
    });
    for (const seed of seeds) {
      expect(seed.x).toBeGreaterThan(-0.4);
      expect(seed.x).toBeLessThan(1.4);
      expect(seed.y).toBeGreaterThan(-0.4);
      expect(seed.y).toBeLessThan(1.4);
    }
    const quadrants = new Set(
      seeds.map((s) => `${s.x > 0.5 ? 1 : 0}${s.y > 0.5 ? 1 : 0}`),
    );
    expect(quadrants.size).toBe(4);
  });

  /** 一生のずれ。全部が同時に消えると面全体が明滅する。 */
  it("staggers the life phases", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 9,
      seed: 5,
    });
    const phases = seeds.map((s) => s.lifePhase).sort((a, b) => a - b);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
    const gaps = phases.slice(1).map((p, i) => p - phases[i]);
    // どの 2 本も同じ時期に生まれない。
    expect(Math.min(...gaps)).toBeGreaterThan(0.01);
  });

  /**
   * 被覆の検査。螺旋配置のときは画面の右上に固まって左半分が地のまま残った
   * (実測)。格子に割ったので、どの帯にも必ず種があることを機械的に守る。
   */
  it("covers every band of the frame", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1.2, 1.5, 1.5],
      count: 16,
      seed: 7,
    });
    for (const band of [0, 1, 2]) {
      const lo = band / 3;
      const hi = (band + 1) / 3;
      expect(
        seeds.some((s) => s.x >= lo && s.x < hi),
        `no stroke in x band ${band}`,
      ).toBe(true);
      expect(
        seeds.some((s) => s.y >= lo && s.y < hi),
        `no stroke in y band ${band}`,
      ).toBe(true);
    }
  });

  /** 同じ色が一箇所に固まらないこと (色の並びを決定的にシャッフルしている)。 */
  it("does not clump one color into a single corner", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1.2, 1.5, 1.5],
      count: 16,
      seed: 7,
    });
    for (const colorIndex of [0, 1, 2, 3]) {
      const xs = seeds.filter((s) => s.colorIndex === colorIndex).map((s) => s.x);
      if (xs.length < 2) continue;
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.25);
    }
  });

  /**
   * 向きのばらつき。0 だと全ストロークが同じ流線に乗って 1 本の帯に融合する
   * (実測: 5 枚すべてが「1 本の三日月」になった)。
   */
  it("gives each stroke its own angle bias", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 16,
      seed: 7,
    });
    const biases = seeds.map((s) => s.angleBias);
    expect(Math.max(...biases) - Math.min(...biases)).toBeGreaterThan(0.3);
    for (const bias of biases) expect(Math.abs(bias)).toBeLessThan(0.5);
  });

  /**
   * スタンプ 1 枚は経路に対して小さいこと。
   *
   * v1 初版はここが平均 0.60・最悪 1.21 で、**スタンプ 1 枚が経路と同じ長さ**
   * だった。そうなると何枚重ねても union は 1 枚の楕円のままで、10月昼の金茶が
   * 縁の立った錠剤形の図形として画面に貼りつく (実測・明るい配色ほど露呈する)。
   */
  it("keeps each stamp small relative to its path", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1.2, 1.5, 1.5],
      count: 26,
      seed: 5,
    });
    for (const seed of seeds) {
      expect(dabToPathRatio(seed)).toBeLessThan(0.2);
    }
  });

  /**
   * ただし小さくしすぎない。1 点を覆うスタンプが 2 枚台前半を切ると、union が
   * つながらず粒が数えられて点線になる。上の検査と必ず対で守る。
   */
  it("still overlaps enough stamps to read as one continuous wash", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1.2, 1.5, 1.5],
      count: 26,
      seed: 5,
    });
    for (const seed of seeds) {
      expect(dabToPathRatio(seed) * STROKE_STEPS).toBeGreaterThan(2.5);
    }
  });

  /**
   * 引き伸ばしは 1 より大きいが控えめ。1 ちょうどだと等方の円のぼかしに戻り
   * (v0 の失敗)、大きくすると上の `dabToPathRatio` が壊れる。
   */
  it("keeps the stamps slightly elongated but not lens-shaped", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 9,
      seed: 5,
    });
    for (const seed of seeds) {
      expect(seed.elongation).toBeGreaterThan(1);
      expect(seed.elongation).toBeLessThan(1.5);
    }
  });

  /**
   * 経路が画面を横切る長さを持つこと。短い経路 + 太い筆が「図形」の正体だった。
   */
  it("gives every stroke a path long enough to cross the frame", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 26,
      seed: 5,
    });
    for (const seed of seeds) {
      expect(seed.length).toBeGreaterThan(1);
    }
  });

  it("marks only some strokes with a rim", () => {
    const seeds = buildStrokeSeeds({
      weights: [1, 1, 1, 1],
      count: 9,
      seed: 5,
    });
    const rimmed = seeds.filter((s) => s.rim).length;
    expect(rimmed).toBeGreaterThan(0);
    expect(rimmed).toBeLessThan(seeds.length);
  });
});

describe("traceStroke", () => {
  const field: FlowField = makeFlowField(FIELD);
  const seed: StrokeSeed = {
    colorIndex: 0,
    x: 0.5,
    y: 0.5,
    length: 0.7,
    width: 0.2,
    elongation: 2.5,
    alpha: 0.14,
    travel: 0.5,
    lifePhase: 0,
    angleBias: 0,
    rim: false,
  };
  const options = { aspect: 1.6, steps: 15, time: 10, lifeProgress: 0.4 };

  it("returns steps + 1 finite points", () => {
    const points = traceStroke(field, seed, options);
    expect(points).toHaveLength(options.steps + 1);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.angle)).toBe(true);
    }
  });

  it("reports progress from 0 to 1", () => {
    const points = traceStroke(field, seed, options);
    expect(points[0].progress).toBe(0);
    expect(points[points.length - 1].progress).toBe(1);
  });

  /** 経路が場に沿って **前へ** 進むこと (その場で振動しないこと)。 */
  it("advances along the field instead of oscillating", () => {
    const points = traceStroke(field, seed, options);
    const start = points[0];
    const end = points[points.length - 1];
    const travelled = Math.hypot(
      (end.x - start.x) * options.aspect,
      end.y - start.y,
    );
    // 経路長の 6 割以上は正味の移動になっているはず (蛇行分を差し引いても)。
    expect(travelled).toBeGreaterThan(seed.length * 0.6);
  });

  it("follows the local direction at each step", () => {
    const points = traceStroke(field, seed, options);
    for (let i = 0; i < points.length - 1; i += 1) {
      const dx = (points[i + 1].x - points[i].x) * options.aspect;
      const dy = points[i + 1].y - points[i].y;
      const heading = Math.atan2(dy, dx);
      expect(Math.abs(heading - points[i].angle)).toBeLessThan(1e-9);
    }
  });

  /**
   * 縦横比を無視すると、横長画面で流れが寝る。
   *
   * `lifeProgress` を 0 にして出発点を揃えてから比べる。出発点の移動も縦横比
   * 補正を通るので、揃えないと「別の場所の流れ」を比べることになる。
   */
  it("keeps the same screen-space heading regardless of aspect ratio", () => {
    const wide = traceStroke(field, seed, {
      ...options,
      aspect: 2.4,
      lifeProgress: 0,
    });
    const square = traceStroke(field, seed, {
      ...options,
      aspect: 1,
      lifeProgress: 0,
    });
    const heading = (points: typeof wide, aspect: number) => {
      const dx = (points[1].x - points[0].x) * aspect;
      const dy = points[1].y - points[0].y;
      return Math.atan2(dy, dx);
    };
    expect(heading(wide, 2.4)).toBeCloseTo(heading(square, 1), 6);
  });

  it("moves the origin further as the life progresses", () => {
    const early = traceStroke(field, seed, { ...options, lifeProgress: 0.05 });
    const late = traceStroke(field, seed, { ...options, lifeProgress: 0.95 });
    const distance = Math.hypot(
      (late[0].x - early[0].x) * options.aspect,
      late[0].y - early[0].y,
    );
    expect(distance).toBeGreaterThan(0.3);
  });

  it("offsets the whole path by the stroke's angle bias", () => {
    const straight = traceStroke(field, seed, options);
    const biased = traceStroke(
      field,
      { ...seed, angleBias: 0.3 },
      { ...options, lifeProgress: 0 },
    );
    const base = traceStroke(field, seed, { ...options, lifeProgress: 0 });
    expect(biased[0].angle - base[0].angle).toBeCloseTo(0.3, 10);
    expect(straight).not.toEqual(biased);
  });

  it("is deterministic", () => {
    expect(traceStroke(field, seed, options)).toEqual(
      traceStroke(field, seed, options),
    );
  });
});

describe("strokeEnvelope / strokeLifeEnvelope", () => {
  it("fades to zero at both ends of the path", () => {
    expect(strokeEnvelope(0)).toBeCloseTo(0, 10);
    expect(strokeEnvelope(1)).toBeCloseTo(0, 10);
    expect(strokeEnvelope(0.5)).toBeCloseTo(1, 10);
  });

  it("clamps out-of-range progress instead of going negative", () => {
    expect(strokeEnvelope(-0.5)).toBeCloseTo(0, 10);
    expect(strokeEnvelope(1.5)).toBeCloseTo(0, 10);
  });

  /**
   * 生まれ変わる瞬間に濃さがゼロであること。ここが 0 でないと、種が出発点へ
   * 戻る瞬間に塊が画面を **瞬間移動して見える**。
   */
  it("is silent at birth and death", () => {
    expect(strokeLifeEnvelope(0)).toBeCloseTo(0, 10);
    expect(strokeLifeEnvelope(1)).toBeCloseTo(0, 10);
    expect(strokeLifeEnvelope(0.5)).toBeCloseTo(1, 10);
  });
});

describe("pathDensity", () => {
  const PHASES = [0, 0.7, 1.9, 3.4, 5.2];
  const samples = (phase: number, depth: number) =>
    Array.from({ length: 200 }, (_, i) => pathDensity(i / 199, phase, depth));

  it("never goes negative or past the ceiling", () => {
    for (const phase of PHASES) {
      for (const depth of [0, 0.26, 0.5, 0.8, 0.95, 1]) {
        for (const value of samples(phase, depth)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1.2);
        }
      }
    }
  });

  /** 深さ 0 は「むら無し」。地の塗りを触らない保証。 */
  it("is flat at depth 0", () => {
    for (const value of samples(2.2, 0)) expect(value).toBeCloseTo(1, 10);
  });

  /**
   * 低い深さでは v1 の式と完全一致すること。地と中間色 (既に成立している淡い面)
   * を、主役の修正の巻き添えで変えないための回帰テスト。
   */
  it("reproduces the v1 mottle exactly at the shallow depth", () => {
    for (const phase of PHASES) {
      for (let i = 0; i <= 40; i += 1) {
        const p = i / 40;
        expect(pathDensity(p, phase, 0.26)).toBeCloseTo(
          0.74 + 0.26 * Math.sin(p * 7.3 + phase),
          10,
        );
      }
    }
  });

  /**
   * 深い設定では経路の途中で **完全に消える** こと。
   *
   * これが v1-fix の失敗の核心で、全長で濃さが途切れないと、太さが揃った
   * リボンとして輪郭を追えてしまう (実測: 10月昼の金茶・8月朝の緑)。
   */
  it("opens real gaps along the path when deep", () => {
    for (const phase of PHASES) {
      const values = samples(phase, 0.95);
      expect(values.some((v) => v === 0)).toBe(true);
      expect(Math.max(...values)).toBeGreaterThan(0.5);
    }
  });

  /** 切れ目が経路の端に寄りきらない (端は `strokeEnvelope` が既に消している)。 */
  it("puts at least one gap inside the visible middle of the path", () => {
    for (const phase of PHASES) {
      const middle = Array.from({ length: 120 }, (_, i) =>
        pathDensity(0.2 + (i / 119) * 0.6, phase, 0.95),
      );
      expect(middle.some((v) => v === 0)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(pathDensity(0.42, 1.3, 0.8)).toBe(pathDensity(0.42, 1.3, 0.8));
  });
});

describe("lateralDrift", () => {
  it("stays inside its declared range", () => {
    for (const phase of [0, 1.1, 2.9, 4.6]) {
      for (let i = 0; i <= 200; i += 1) {
        const value = lateralDrift(i / 200, phase);
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
    }
  });

  /** 中心線が本当にゆらぐこと。ゆらがないと経路が「管」のままになる。 */
  it("swings to both sides along one path", () => {
    for (const phase of [0, 1.1, 2.9, 4.6]) {
      const values = Array.from({ length: 200 }, (_, i) =>
        lateralDrift(i / 199, phase),
      );
      expect(Math.max(...values)).toBeGreaterThan(0.3);
      expect(Math.min(...values)).toBeLessThan(-0.3);
    }
  });

  /** 隣り合う点で跳ばないこと (跳ぶと経路がぎざぎざに割れる)。 */
  it("moves smoothly between neighbouring points", () => {
    let worst = 0;
    for (let i = 0; i < 400; i += 1) {
      worst = Math.max(
        worst,
        Math.abs(lateralDrift((i + 1) / 400, 2.2) - lateralDrift(i / 400, 2.2)),
      );
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe("dabScatter", () => {
  it("keeps the radius positive and bounded", () => {
    for (const phase of [0, 1.7, 3.3, 5.5]) {
      for (let i = 0; i <= 200; i += 1) {
        const value = dabScatter(i / 200, phase);
        expect(value).toBeGreaterThan(0.4);
        expect(value).toBeLessThan(1.6);
      }
    }
  });

  /** 大小が本当に混ざること。揃っていると縁が均質な包絡線になる。 */
  it("mixes big and small stamps along one path", () => {
    for (const phase of [0, 1.7, 3.3, 5.5]) {
      const values = Array.from({ length: 200 }, (_, i) =>
        dabScatter(i / 199, phase),
      );
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5);
    }
  });
});

describe("strokeLifeProgress", () => {
  it("cycles through 0-1 with the given period", () => {
    expect(strokeLifeProgress(0, 30, 0)).toBeCloseTo(0, 10);
    expect(strokeLifeProgress(15, 30, 0)).toBeCloseTo(0.5, 10);
    expect(strokeLifeProgress(30, 30, 0)).toBeCloseTo(0, 10);
    expect(strokeLifeProgress(45, 30, 0)).toBeCloseTo(0.5, 10);
  });

  it("offsets by the phase", () => {
    expect(strokeLifeProgress(0, 30, 0.25)).toBeCloseTo(0.25, 10);
  });

  it("always returns a value inside [0, 1)", () => {
    for (let t = 0; t < 200; t += 0.7) {
      const value = strokeLifeProgress(t, 31, 0.37);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
