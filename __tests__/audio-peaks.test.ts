/**
 * 波形 (peaks) ヘルパのテスト。
 *
 * ここで守りたいのは 2 点:
 * 1. ハッシュが決定的であること — 生成スクリプトの保存先と UI のルックアップ先が
 *    同じキーにならないと、事前計算した波形が永遠に見つからない。
 * 2. 合成波形が常に 0..1 に収まること — UI は値を height の % に直に入れるので、
 *    1 を超えると棒が枠から飛び出す。
 */
import { describe, it, expect } from "vitest";

import {
  PEAKS_BUCKETS,
  hashString,
  normalizePeaks,
  peaksKey,
  peaksUrl,
  synthesizePeaks,
} from "@/lib/audio/peaks";

describe("hashString", () => {
  it("同じ入力なら常に同じ値を返す", () => {
    expect(hashString("https://example.com/a.mp3")).toBe(
      hashString("https://example.com/a.mp3")
    );
  });

  it("入力が違えば値も違う", () => {
    expect(hashString("https://example.com/a.mp3")).not.toBe(
      hashString("https://example.com/b.mp3")
    );
  });

  it("常に 8 桁の 16 進を返す", () => {
    for (const s of ["", "a", "https://example.com/very/long/path/to/audio.mp3"]) {
      expect(hashString(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("生成スクリプトと同じキーを出す (実際に生成済みの音源で確認)", () => {
    // scripts/audio/generate-peaks.mjs が実際にこのキーで書き出したもの。
    // 片方の実装を変えたらここで落ちる。
    expect(
      hashString("https://iib5b7jkxstwom3v.public.blob.vercel-storage.com/audio/bgm.mp3")
    ).toBe("cdc20f92");
  });
});

describe("peaksKey / peaksUrl", () => {
  it("公開パスを組み立てる", () => {
    const src = "https://example.com/a.mp3";
    expect(peaksUrl(src)).toBe(`/audio/peaks/${peaksKey(src)}.json`);
  });
});

describe("synthesizePeaks", () => {
  it("指定した本数を返す", () => {
    expect(synthesizePeaks("x").length).toBe(PEAKS_BUCKETS);
    expect(synthesizePeaks("x", 32).length).toBe(32);
  });

  it("すべて 0..1 に収まる", () => {
    for (const v of synthesizePeaks("https://example.com/a.mp3")) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("下限を持つ (帯が途切れて見えないように)", () => {
    for (const v of synthesizePeaks("https://example.com/a.mp3")) {
      expect(v).toBeGreaterThanOrEqual(0.08);
    }
  });

  it("同じ src なら同じ形 (SSR と CSR で描き分かれない)", () => {
    expect(synthesizePeaks("same")).toEqual(synthesizePeaks("same"));
  });

  it("src が違えば形も違う", () => {
    expect(synthesizePeaks("a")).not.toEqual(synthesizePeaks("b"));
  });
});

describe("normalizePeaks", () => {
  it("最大値が 1 になるように正規化する", () => {
    const out = normalizePeaks([1, 2, 4], 3);
    expect(Math.max(...out)).toBe(1);
  });

  it("指定した本数に均す", () => {
    expect(normalizePeaks([1, 2, 3, 4, 5, 6, 7, 8], 4).length).toBe(4);
    expect(normalizePeaks([1, 2, 3], 10).length).toBe(10);
  });

  it("空配列は空を返す", () => {
    expect(normalizePeaks([], 10)).toEqual([]);
  });

  it("無音 (全部 0) でも 0 除算せず下限で埋める", () => {
    const out = normalizePeaks([0, 0, 0], 3);
    expect(out).toEqual([0.08, 0.08, 0.08]);
  });

  it("すべて 0..1 に収まる", () => {
    for (const v of normalizePeaks([3, 100, 7, 0, 42], 16)) {
      expect(v).toBeGreaterThanOrEqual(0.08);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
