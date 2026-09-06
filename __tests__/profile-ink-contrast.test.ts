/**
 * roji プロファイル (ミクロ⇔マクロ) — 字が読める濃さか / 黒を面で使っていないか。
 *
 * ## この検査が存在する理由 (独立 QA が本番で実測した指摘)
 *
 * 1. **一般語のコントラストが 1.48〜2.23:1** しかなかった (可読の基準は 4.5:1)。
 *    淡い苔 (`usukoke`) を 65% で紙 (`kinari`) に置いていたため。
 * 2. **コードとコメントが逆を言っていた**。`app/globals.css` には「黒・近黒
 *    (sumi) は使わない (Setaka 却下済み)」とあるのに、描き手は自分の粒を `sumi`
 *    で塗っていた。
 *
 * 2 の裁定 (Boss): オーナーの元の言葉は「黒**背景**が怖い」。よってルールは
 * **「黒・近黒は背景・大面積に使わない。文字・記号のインクとしては可」**であり、
 * 判定は色の値ではなく**面積**で行う。面積の実測は実 Canvas が要るので
 * `components/viz/profile/profile-stage.stories.tsx` の play が画素で数える。
 * この unit 側は、その前提となる **色そのものの性質**を固定する。
 */

import { describe, expect, it } from "vitest";

import { WORD_LAYERS } from "@/components/viz/profile/renderers/canvas";
import {
  PROFILE_DARK_LUMA_THRESHOLD,
  PROFILE_TEXT_MIN_CONTRAST,
} from "@/lib/profile/thresholds";
import {
  contrastRatio,
  hexToRgb,
  perceivedLuma,
  ROJI_VIZ_COLOR,
} from "@/lib/viz/roji-viz-palette";

const PAPER = ROJI_VIZ_COLOR.kinari;

describe("図の中の字は紙に対して 4.5:1 以上", () => {
  it.each(WORD_LAYERS.map((l) => [l.key, l.color] as const))(
    "%s の字 (%s) は基準を満たす",
    (key, color) => {
      const ratio = contrastRatio(color, PAPER);
      expect(ratio, `${key}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        PROFILE_TEXT_MIN_CONTRAST,
      );
    },
  );

  it("回帰: 旧実装の一般語 (淡い苔) は基準を満たさない", () => {
    /* 「直したつもりで元に戻す」を止めるための逆向きの固定。淡い苔は不透明に
       しても 2.4:1 で、65% で置いていた旧実装は 1.6:1 だった。 */
    expect(contrastRatio(ROJI_VIZ_COLOR.usukoke, PAPER)).toBeLessThan(
      PROFILE_TEXT_MIN_CONTRAST,
    );
  });

  it("自分と他者は色の濃さ (とウェイト) で分かれる — 淡さで分けない", () => {
    const general = WORD_LAYERS.find((l) => l.key === "general")!;
    const personal = WORD_LAYERS.find((l) => l.key === "personal")!;
    const shared = WORD_LAYERS.find((l) => l.key === "shared")!;

    // 自分の言葉が最も濃い。
    expect(contrastRatio(personal.color, PAPER)).toBeGreaterThan(
      contrastRatio(general.color, PAPER),
    );
    // 自分の言葉は他者の共通語と同じ濃さで、ウェイトで分かれる。
    expect(personal.color).toBe(shared.color);
    expect(personal.weight).toBeGreaterThan(shared.weight);
  });
});

describe("黒・近黒はインクとしてだけ使う (面には使わない)", () => {
  it("地の色は近黒ではない", () => {
    const [r, g, b] = hexToRgb(PAPER);
    expect(perceivedLuma(r, g, b)).toBeGreaterThan(PROFILE_DARK_LUMA_THRESHOLD);
  });

  it("面を塗るのに使う色は、どれも近黒より明るい", () => {
    /* 地の面 (濃度の面) の色域と、板の中で面として置く色。ここに近黒が入ると、
       画素の 0.5% を越える暗さが出る余地ができる。 */
    for (const name of ["kinari", "usukoke", "koke", "suna"] as const) {
      const [r, g, b] = hexToRgb(ROJI_VIZ_COLOR[name]);
      expect(perceivedLuma(r, g, b), name).toBeGreaterThan(PROFILE_DARK_LUMA_THRESHOLD);
    }
  });

  it("墨はインクとして使ってよい (値そのものは禁じない)", () => {
    /* 墨 #2B2B2B の luma は 43 で、しきい値 40 より明るい。つまり「墨で字を
       書く」だけでは面積の検査に 1 画素も計上されない。禁じているのは面である。 */
    const [r, g, b] = hexToRgb(ROJI_VIZ_COLOR.sumi);
    expect(perceivedLuma(r, g, b)).toBeCloseTo(43, 0);
    expect(WORD_LAYERS.some((l) => l.color === ROJI_VIZ_COLOR.sumi)).toBe(true);
  });
});
