/**
 * semantic-colors.test.ts
 *
 * 再ドリフト防止ガード。`tokens/base.json` の semantic 色が Figma R2 確定版の
 * Variables と一致し続けることを assert する。
 *
 * なぜ必要か: 色トークンは過去に 4 回ドリフトした (card / destructive /
 * secondary / foreground)。いずれも「値を直す」対応だけで、次のページ実装で
 * また旧値が混ざった。忠実度表 (docs/fidelity/*.md) は人が書く記録なので
 * ガードにならない。ここで機械的に固定する。
 *
 * 期待値の出どころ:
 *   mcp__figma__get_variable_defs(fileKey=AWLnI0XF07e8rScuxPYPc7, nodeId=8109:46558)
 *   → {"foreground":"#464748","border":"#888675","muted":"#dedccf",
 *      "primary-foreground":"#f9f8f4","primary":"#464748","sand":"#d5d3c0",
 *      "muted-foreground":"#585854","background":"#ebe9e0"}
 *   (destructive #ae4751 は nodeId=5344:3 で取得。C6-1R で是正済み)
 *
 * 値を変えたいときは Figma を先に直し、ここの期待値を Figma の実測値で
 * 更新すること。テストを通すために期待値を実装値に合わせるのは禁止 (それでは
 * ガードの意味がない)。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// oklch(L C H) -> sRGB hex。tokens/config.mjs の hexToOklch の逆変換。
// ブラウザや外部ライブラリに依存させない (テストが環境で揺れないように)。
// ---------------------------------------------------------------------------

function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // Oklab -> LMS (立方)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  // LMS -> linear sRGB
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const enc = (v: number) => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(srgb * 255)));
  };

  return `#${[enc(r), enc(g), enc(bl)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseOklch(value: string): [number, number, number] {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`oklch() として解釈できない値: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// ---------------------------------------------------------------------------
// tokens/base.json
// ---------------------------------------------------------------------------

type Leaf = { $value: string };
type Group = Record<string, Leaf | string | undefined>;

const baseTokens = JSON.parse(
  readFileSync(resolve(__dirname, "../../tokens/base.json"), "utf8"),
) as { color: { semantic: Group; brand: Group } };

function tokenHex(group: Group, name: string): string {
  const leaf = group[name];
  if (typeof leaf !== "object" || leaf === null || typeof leaf.$value !== "string") {
    throw new Error(`トークンが見つからない: ${name}`);
  }
  return oklchToHex(...parseOklch(leaf.$value));
}

// Figma R2 確定版の Variables (上のコメントの出どころ参照)
const FIGMA_SEMANTIC: Record<string, string> = {
  background: "#ebe9e0",
  foreground: "#464748",
  card: "#f4f3ed",
  "card-foreground": "#464748",
  "popover-foreground": "#464748",
  primary: "#464748",
  "primary-foreground": "#f9f8f4",
  secondary: "#d5d3c0",
  "secondary-foreground": "#464748",
  muted: "#dedccf",
  "muted-foreground": "#585854",
  destructive: "#ae4751",
  border: "#888675",
  input: "#888675",
  ring: "#888675",
};

describe("semantic 色トークンが Figma R2 確定版と一致する", () => {
  for (const [name, expected] of Object.entries(FIGMA_SEMANTIC)) {
    it(`${name} = ${expected}`, () => {
      expect(tokenHex(baseTokens.color.semantic, name)).toBe(expected);
    });
  }
});

describe("面と文字の役割が崩れていない", () => {
  it("muted は background と別の面である (同値だと写真枠が地に溶ける)", () => {
    expect(tokenHex(baseTokens.color.semantic, "muted")).not.toBe(
      tokenHex(baseTokens.color.semantic, "background"),
    );
  });

  it("foreground / card-foreground / popover-foreground は同値 (Figma は foreground 1 変数)", () => {
    const fg = tokenHex(baseTokens.color.semantic, "foreground");
    expect(tokenHex(baseTokens.color.semantic, "card-foreground")).toBe(fg);
    expect(tokenHex(baseTokens.color.semantic, "popover-foreground")).toBe(fg);
  });

  it("border / input / ring は同値 (輪郭ロールは 1 色)", () => {
    const border = tokenHex(baseTokens.color.semantic, "border");
    expect(tokenHex(baseTokens.color.semantic, "input")).toBe(border);
    expect(tokenHex(baseTokens.color.semantic, "ring")).toBe(border);
  });

  it("secondary は金 (#ffc200 系) ではない (Webflow 由来のドリフト再発検知)", () => {
    expect(tokenHex(baseTokens.color.semantic, "secondary")).not.toMatch(/^#ffc[0-9a-f]{3}$/);
  });
});

// ---------------------------------------------------------------------------
// WCAG コントラスト。Figma 値を守った状態で AA を満たすことを固定する。
// ---------------------------------------------------------------------------

function relativeLuminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("主要な文字と面の組み合わせが WCAG AA を満たす", () => {
  const s = baseTokens.color.semantic;
  const hex = (n: string) => tokenHex(s, n);

  const textPairs: [string, string, number][] = [
    ["foreground", "background", 4.5],
    ["foreground", "card", 4.5],
    ["foreground", "muted", 4.5],
    ["foreground", "secondary", 4.5],
    ["card-foreground", "card", 4.5],
    ["muted-foreground", "background", 4.5],
    ["muted-foreground", "muted", 4.5],
    ["primary-foreground", "primary", 4.5],
    ["secondary-foreground", "secondary", 4.5],
    ["destructive", "card", 4.5],
    ["destructive", "background", 4.5],
  ];

  for (const [fg, bg, min] of textPairs) {
    it(`${fg} on ${bg} >= ${min}:1`, () => {
      expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(min);
    });
  }

  // UI 部品 (罫線・フォーカス) は 3:1
  const uiPairs: [string, string, number][] = [
    ["border", "background", 3],
    ["border", "card", 3],
    ["ring", "background", 3],
  ];

  for (const [fg, bg, min] of uiPairs) {
    it(`${fg} on ${bg} >= ${min}:1 (UI 部品)`, () => {
      expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(min);
    });
  }

  // 既知の未達: border を muted 面の内側に引くと 2.668:1。外側は background で
  // 3.022:1 なので罫線は識別できる。両側が muted になる罫線を作らないこと。
  it("border on muted は 3:1 未満 (既知・両側 muted の罫線を作らない前提)", () => {
    expect(contrastRatio(hex("border"), hex("muted"))).toBeLessThan(3);
  });
});
