import { describe, expect, it } from "vitest";

import { paperGrainTile, periodicValueNoise } from "@/lib/roji/paper-grain";

const SIZE = 64;
const INTENSITY = 30;
const tile = (seed = 5) => paperGrainTile({ size: SIZE, seed, intensity: INTENSITY });

/** 画素 i の透明度。 */
const alphaAt = (data: Uint8ClampedArray, x: number, y: number) =>
  data[(y * SIZE + x) * 4 + 3];

describe("periodicValueNoise", () => {
  it("wraps seamlessly at the tile edge", () => {
    const noise = periodicValueNoise(4, 11);
    for (let i = 0; i <= 10; i += 1) {
      const v = i / 10;
      // 0 と 1 は同じ点。ここが一致しないとタイルの継ぎ目が線として見える。
      expect(noise(0, v)).toBeCloseTo(noise(1, v), 6);
      expect(noise(v, 0)).toBeCloseTo(noise(v, 1), 6);
    }
  });

  it("stays inside 0-1", () => {
    const noise = periodicValueNoise(8, 3);
    for (let i = 0; i < 500; i += 1) {
      const value = noise((i * 0.017) % 1, (i * 0.031) % 1);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is smooth (no jumps between neighbouring samples)", () => {
    const noise = periodicValueNoise(8, 3);
    let worst = 0;
    for (let x = 0; x < 1; x += 0.01) {
      for (let y = 0; y < 1; y += 0.01) {
        worst = Math.max(worst, Math.abs(noise(x + 0.005, y) - noise(x, y)));
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  it("is deterministic for the same seed", () => {
    const a = periodicValueNoise(8, 21);
    const b = periodicValueNoise(8, 21);
    expect(a(0.3, 0.7)).toBe(b(0.3, 0.7));
  });
});

describe("paperGrainTile", () => {
  it("fills an RGBA buffer of the requested size", () => {
    expect(tile()).toHaveLength(SIZE * SIZE * 4);
  });

  it("is deterministic for the same seed", () => {
    expect(Array.from(tile(5))).toEqual(Array.from(tile(5)));
  });

  it("differs for a different seed", () => {
    expect(Array.from(tile(5))).not.toEqual(Array.from(tile(6)));
  });

  /**
   * 紙の繊維は光を返すので、暗い粒だけでなく明るい粒もある。黒一色の粒だと
   * 「汚れ」に見える (v0 の粒子はこれだった)。
   */
  it("mixes light flecks with dark specks", () => {
    const data = tile();
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 3) continue;
      if (data[i] === 0) dark += 1;
      else light += 1;
    }
    expect(dark).toBeGreaterThan(100);
    expect(light).toBeGreaterThan(100);
  });

  /**
   * v1 の要件そのもの: 粒が均質なフィルムノイズではなく、**場所によって濃さが
   * ばらつく** こと。タイルをブロックに割って平均を取り、ブロック間の散らばりが
   * 一様乱数から期待される値より明確に大きいことを確かめる。
   */
  it("is uneven across the tile, unlike flat film noise", () => {
    const data = tile();
    const block = 8;
    const blocks = SIZE / block;
    const means: number[] = [];
    for (let by = 0; by < blocks; by += 1) {
      for (let bx = 0; bx < blocks; bx += 1) {
        let sum = 0;
        for (let y = 0; y < block; y += 1) {
          for (let x = 0; x < block; x += 1) {
            sum += alphaAt(data, bx * block + x, by * block + y);
          }
        }
        means.push(sum / (block * block));
      }
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    const sd = Math.sqrt(
      means.reduce((sum, m) => sum + (m - mean) ** 2, 0) / means.length,
    );
    // ブロック平均が全部同じなら sd は 0 に近い。低周波のムラがある証拠として
    // 平均の 12% 以上の散らばりを要求する。
    expect(sd / mean).toBeGreaterThan(0.12);
  });

  /** 粒径のばらつき。隣り合う画素がまったく無相関だと粒はすべて 1px になる。 */
  it("contains grains larger than a single pixel", () => {
    const data = tile();
    let same = 0;
    let total = 0;
    for (let y = 0; y < SIZE; y += 2) {
      for (let x = 0; x < SIZE - 1; x += 2) {
        total += 1;
        if (data[(y * SIZE + x) * 4] === data[(y * SIZE + x + 1) * 4]) same += 1;
      }
    }
    // 完全な白色雑音なら約 50%。粗い粒 (2x2) が混ざるので有意に上回る。
    expect(same / total).toBeGreaterThan(0.6);
  });

  it("never exceeds the requested intensity by much", () => {
    const data = tile();
    let over = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > INTENSITY) over += 1;
    }
    // 繊維の筋だけは粒の上に重なるので少しはみ出す。全体の 2% 未満に留める。
    expect(over / (SIZE * SIZE)).toBeLessThan(0.02);
  });

  it("scales with intensity", () => {
    const mean = (intensity: number) => {
      const data = paperGrainTile({ size: SIZE, seed: 5, intensity });
      let sum = 0;
      for (let i = 3; i < data.length; i += 4) sum += data[i];
      return sum / (SIZE * SIZE);
    };
    expect(mean(40)).toBeGreaterThan(mean(20));
  });
});
