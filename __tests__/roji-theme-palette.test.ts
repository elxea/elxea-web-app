import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hexToOklch } from "@/lib/roji/color";
import { seasonalPaletteFor, TIMES_OF_DAY } from "@/lib/roji/seasonal-palette";
import {
  asJournalTheme,
  themePaletteFor,
  themeQuad,
  JOURNAL_THEMES,
  JOURNAL_THEME_COLOR,
  type JournalTheme,
} from "@/lib/roji/theme-palette";

/**
 * 号のテーマ色から作る面の色。
 *
 * 守るのは 3 つ。
 * 1. **号の色が面に出ていること** — テーマが違えば面の色が違う。同じなら
 *    「テーマ色を活かす」が実現していない
 * 2. **季節の面と同じ帯にいること** — 彩度・明度の設計を共有する。elxea journal
 *    だけ背景の強さが違う、が起きてはいけない
 * 3. **トークンと切れていないこと** — テーマ色の実値は `dist/tokens.css` の写しで、
 *    トークンが動いたらここが落ちる
 */

const TOKENS_CSS = readFileSync(
  path.join(process.cwd(), "dist", "tokens.css"),
  "utf8",
);

/** 色相環上の短い方の弧の長さ (0-180)。 */
function hueDistance(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

const TOKEN_NAME: Record<JournalTheme, string> = {
  akane: "color-brand-tea-red",
  sui: "color-brand-tea-green",
  sohi: "color-brand-tea-warm",
};

describe("トークンとの対応", () => {
  it("テーマ色の実値は dist/tokens.css と一致する", () => {
    for (const theme of JOURNAL_THEMES) {
      const match = TOKENS_CSS.match(
        new RegExp(
          `--${TOKEN_NAME[theme]}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`,
        ),
      );
      expect(match, `token --${TOKEN_NAME[theme]} が見つからない`).toBeTruthy();
      const [, l, c, h] = match as RegExpMatchArray;
      expect(JOURNAL_THEME_COLOR[theme]).toEqual({
        l: Number(l),
        c: Number(c),
        h: Number(h),
      });
    }
  });
});

describe("asJournalTheme", () => {
  it("既知のテーマはそのまま通す", () => {
    for (const theme of JOURNAL_THEMES) {
      expect(asJournalTheme(theme)).toBe(theme);
    }
  });

  it("未知・空・null は null (季節の色へ落ちる)", () => {
    expect(asJournalTheme("kohaku")).toBeNull();
    expect(asJournalTheme("")).toBeNull();
    expect(asJournalTheme(null)).toBeNull();
    expect(asJournalTheme(undefined)).toBeNull();
  });
});

describe("themeQuad (時間帯を掛ける前の 4 色)", () => {
  it("彩度は月の色と同じ帯に収まる", () => {
    // MONTHLY_BASE の実測レンジ。テーマ側だけが濃い / 淡いと面の強さが揃わない。
    const MONTH_CHROMA_MIN = 0.006;
    const MONTH_CHROMA_MAX = 0.062;
    for (const theme of JOURNAL_THEMES) {
      for (const color of themeQuad(theme)) {
        expect(color.c).toBeGreaterThanOrEqual(MONTH_CHROMA_MIN);
        expect(color.c).toBeLessThanOrEqual(MONTH_CHROMA_MAX);
      }
    }
  });

  it("明度は月の色と同じ帯に収まる", () => {
    for (const theme of JOURNAL_THEMES) {
      for (const color of themeQuad(theme)) {
        expect(color.l).toBeGreaterThanOrEqual(0.75);
        expect(color.l).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it("テーマ色の色相をそのまま持つ色が 1 つある", () => {
    for (const theme of JOURNAL_THEMES) {
      const hues = themeQuad(theme).map((c) => c.h);
      const target = JOURNAL_THEME_COLOR[theme].h;
      // 色相は 0-360 へ正規化する過程で浮動小数の丸めが乗るので厳密一致では見ない。
      expect(hues.some((h) => Math.abs(h - target) < 1e-6)).toBe(true);
    }
  });

  it("トークンの彩度の大小関係は残る (茜がいちばん濃い)", () => {
    const lead = (theme: JournalTheme) => themeQuad(theme)[0].c;
    expect(lead("akane")).toBeGreaterThan(lead("sohi"));
    expect(lead("sohi")).toBeGreaterThan(lead("sui"));
  });
});

describe("themePaletteFor", () => {
  it("3 テーマ x 4 時間帯すべてで有効な 4 色を返す", () => {
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        const palette = themePaletteFor(theme, time);
        expect(palette).toHaveLength(4);
        for (const hex of palette) {
          expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        }
        // 4 色が潰れていない (面の階調が 1 段になっていない)。
        expect(new Set(palette).size).toBe(4);
      }
    }
  });

  it("彩度は季節の面と同じ上限に収まる", () => {
    // TIME_SHAPE の chromaCap の最大値 (夕・夜の accent = 0.125)。
    const CHROMA_CAP = 0.125;
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of themePaletteFor(theme, time)) {
          expect(hexToOklch(hex).c).toBeLessThanOrEqual(CHROMA_CAP + 1e-3);
        }
      }
    }
  });

  it("明度は季節の面と同じ帯に収まる", () => {
    // seasonal-palette の MIN_LIGHTNESS / MAX_LIGHTNESS。
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of themePaletteFor(theme, time)) {
          const { l } = hexToOklch(hex);
          expect(l).toBeGreaterThanOrEqual(0.16 - 1e-3);
          expect(l).toBeLessThanOrEqual(0.97 + 1e-3);
        }
      }
    }
  });

  it("テーマが違えば面の色が違う (号の色が出ている)", () => {
    for (const time of TIMES_OF_DAY) {
      const byTheme = JOURNAL_THEMES.map((t) => themePaletteFor(t, time).join(","));
      expect(new Set(byTheme).size).toBe(JOURNAL_THEMES.length);
    }
  });

  it("どの時間帯でも主役はテーマ由来の色から選ばれる (中立色に奪われない)", () => {
    // `themeQuad` の添字 0/1 がテーマ色由来 (色相 = テーマ色 / テーマ色 +26 度)、
    // 2/3 が中立の地 (色相 250)。「号の色が面に出ている」の実体は
    // **主役 = 最も彩度の高い色が 0/1 のどちらかであること** で、色相の角度では
    // ない。暗い時間帯は「琥珀にいちばん近い色」が主役になる規則なので、中立色を
    // 暖色側に置くと主役が 2/3 に移ってここが落ちる (寒色側へ逃がしている理由)。
    const THEME_DERIVED = [0, 1];
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        const colors = themePaletteFor(theme, time).map(hexToOklch);
        const leadIndex = colors.reduce(
          (best, c, i) => (c.c > colors[best].c ? i : best),
          0,
        );
        expect(
          THEME_DERIVED,
          `${theme}/${time} 主役が中立の地 (添字 ${leadIndex}) になっている`,
        ).toContain(leadIndex);
      }
    }
  });

  it("主役の色相は暖色寄せの設計幅を超えて流れない", () => {
    // 夕・夜は面の主役を「灯り」にするため色相を暖色アンカーへ寄せる
    // (`TIME_SHAPE`: 夕 = 48 度へ 0.36、夜 = 62 度へ 0.32)。これは季節の面と
    // 共有する設計で、テーマ色の経路だけ止めることはしない (止めると
    // 「elxea journal の夕方だけ灯りが点らない」分岐になる)。
    //
    // よってテーマ色からのズレは 0 にはならない。上限は設計から出る:
    // 寄せ量 0.36 x 最大の弧 (テーマ色 -> 48 度) で、実測の最大は
    // 翠/夕の 47.1 度 (178.3 -> 131.2)。50 はその設計上の天井であって
    // 好みの値ではない。ここが 50 を超えるときは寄せ量かアンカーが動いており、
    // 号の色が面から失われていないかを実物で見る必要がある。
    const DESIGNED_MAX_DRIFT = 50;
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        const colors = themePaletteFor(theme, time).map(hexToOklch);
        const lead = colors.reduce((best, c) => (c.c > best.c ? c : best));
        const themeHue = JOURNAL_THEME_COLOR[theme].h;
        const distance = hueDistance(lead.h, themeHue);
        expect(
          distance,
          `${theme}/${time} 主役の色相 ${lead.h.toFixed(1)} (テーマ ${themeHue})`,
        ).toBeLessThan(DESIGNED_MAX_DRIFT);
      }
    }
  });

  it("季節の面と同じ整形を通っている (時間帯で色が動く)", () => {
    for (const theme of JOURNAL_THEMES) {
      const byTime = TIMES_OF_DAY.map((t) => themePaletteFor(theme, t).join(","));
      expect(new Set(byTime).size).toBe(TIMES_OF_DAY.length);
    }
  });

  it("季節の面 (同じ時間帯) とは別の色になる", () => {
    for (const time of TIMES_OF_DAY) {
      for (const theme of JOURNAL_THEMES) {
        expect(themePaletteFor(theme, time).join(",")).not.toBe(
          seasonalPaletteFor(8, time).join(","),
        );
      }
    }
  });
});
