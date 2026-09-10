/**
 * ズーム用の写真を**押される前に**取っておく規則を縛る (網羅表 2026-08-27 / G3・B2・B3)。
 *
 * ## 直している症状
 *
 * PR #169 でメイン写真 (800px) の先読みは入ったが、ズームは 1200px という
 * **別の URL** を使う。`next/image` は `width` / `sizes` から
 * `_next/image?...&w=` を組み立てるので、800px が温まっていてもズームは
 * 1 度も取られていない。しかも Radix の Dialog は閉じるとアンマウントされる
 * ので、開くたびに毎回「初回」になる。
 *
 * ここで縛る契約:
 *   1. 温めるのは「いま出ている 1 枚」。閉じているあいだは左右を取らない
 *      (押されるか分からない大きい写真を 7 枚まとめて取らない)。
 *   2. ズームが開いているあいだだけ左右を足す (前へ / 次へで次に要るのは隣)。
 *   3. 温めた枚数は減らさない。かつ**増えないときは同じ配列を返す**
 *      (毎回新しい配列だと、これを state に入れた効果が自分を呼び直す)。
 *   4. 先読みの指定 (`ZOOM_EDGE` / `ZOOM_SIZES`) と本番の指定が**同じ文字列**で
 *      あること。1 文字違うと別の URL を取るので先読みが丸ごと無駄になる。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mergeWarm, zoomWarmTargets } from "@/components/product/image-gallery-warm";

describe("温める枚数 (zoomWarmTargets)", () => {
  it("閉じているときは、いま出ている 1 枚だけ", () => {
    expect(zoomWarmTargets(0, 7, false)).toEqual([0]);
    expect(zoomWarmTargets(3, 7, false)).toEqual([3]);
  });

  it("開いているときは左右も足す (前へ / 次への行き先)", () => {
    expect(zoomWarmTargets(3, 7, true).sort()).toEqual([2, 3, 4]);
  });

  it("端では反対の端へ回り込む (前へ / 次へが循環するため)", () => {
    expect(zoomWarmTargets(0, 7, true).sort()).toEqual([0, 1, 6]);
    expect(zoomWarmTargets(6, 7, true).sort()).toEqual([0, 5, 6]);
  });

  it("1 枚しか無いときは左右を足さない (同じ 1 枚を 3 回数えない)", () => {
    expect(zoomWarmTargets(0, 1, true)).toEqual([0]);
  });

  it("写真が無い / 範囲外は何も温めない", () => {
    expect(zoomWarmTargets(0, 0, true)).toEqual([]);
    expect(zoomWarmTargets(9, 3, true)).toEqual([]);
    expect(zoomWarmTargets(-1, 3, true)).toEqual([]);
  });

  /* 負の検査 — 「全部温める」実装に差し替わったら落ちる。 */
  it("閉じているのに全部温める実装は不合格", () => {
    const targets = zoomWarmTargets(0, 7, false);
    expect(targets.length).toBeLessThan(7);
  });
});

describe("温めた集合の積み上げ (mergeWarm)", () => {
  it("新しいぶんだけ足す", () => {
    expect(mergeWarm([0], [1, 2])).toEqual([0, 1, 2]);
  });

  it("既に温めてあるものは足さない", () => {
    expect(mergeWarm([0, 1], [1])).toEqual([0, 1]);
  });

  it("増えないときは**同じ配列**を返す (描き直しの無限ループを作らない)", () => {
    const current = [0, 1];
    expect(mergeWarm(current, [1, 0])).toBe(current);
  });

  it("温めたぶんを取り下げない (行ったり来たりで取り直しにしない)", () => {
    expect(mergeWarm([0, 1, 2], [5])).toEqual([0, 1, 2, 5]);
  });
});

/* -------------------------------------------------------------------------- */
/* 先読みと本番が同じ URL を指しているか                                        */
/* -------------------------------------------------------------------------- */

const GALLERY = readFileSync(
  join(process.cwd(), "components/product/image-gallery.tsx"),
  "utf8",
);

/** `const NAME = 123;` の値を読む。 */
function numericConst(source: string, name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`).exec(source);
  if (!m) throw new Error(`${name} が image-gallery.tsx に無い`);
  return Number(m[1]);
}

describe("先読みと本番の指定が一致している", () => {
  it("ズームはメインと別の寸法を使う (= メインの先読みでは温まらない)", () => {
    /* これが等しくなったら、そもそもズーム専用の先読みは要らない。
       等しくないからこの機構が要る、という前提そのものを縛る。 */
    expect(numericConst(GALLERY, "ZOOM_EDGE")).not.toBe(numericConst(GALLERY, "MAIN_EDGE"));
  });

  it("生の数字・生の sizes を JSX に直書きしない (先読みとズレる唯一の経路)", () => {
    /* `width={1200}` / `sizes="90vw"` が JSX に残っていると、片方だけ直したときに
       先読みと本番が別 URL になる。定数経由なら構造的にズレない。 */
    expect(GALLERY).not.toMatch(/width=\{1200\}/);
    expect(GALLERY).not.toMatch(/sizes="90vw"/);
  });

  it("ズームの指定は先読みと本番の 2 か所で使われている", () => {
    const edge = GALLERY.match(/width=\{ZOOM_EDGE\}/g) ?? [];
    const sizes = GALLERY.match(/sizes=\{ZOOM_SIZES\}/g) ?? [];
    expect(edge.length, "ZOOM_EDGE が先読みと本番の両方に無い").toBe(2);
    expect(sizes.length, "ZOOM_SIZES が先読みと本番の両方に無い").toBe(2);
  });
});
