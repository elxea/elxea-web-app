import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * z の 1 系統を守る番人 (2026-08-18 新設)
 *
 * z の順位の正本は `app/globals.css` の名前付きレイヤー `--z-*` だけ。この
 * テストは、その 1 系統が壊れる 3 通りを機械的に止める:
 *
 * 1. `components/ui/**` の生 `z-50` を名前付きレイヤーへ繋ぐブリッジが消える
 * 2. ブリッジが cascade layer の中へ入る (= Tailwind 組込みに負けて無効化する)
 * 3. **画面に固定される面** が生スケールの z を持つ / ブリッジが効かない
 *    variant 形の `z-50` が使われる
 *
 * 3 の後半が要るのは、ブリッジが素のクラス `.z-50` 1 個しか上書きしないため。
 * `md:z-50` は別クラス (`.md\:z-50`) として出力されるのでブリッジを通らず、
 * 50 のまま下端固定 UI (1020) に負ける。CSS 側で全 variant を潰すことはできない
 * ので、使わせないことで担保する。
 *
 * ## 何を検査しないか (意図的)
 *
 * `relative` / `absolute` の中だけで前後を決める局所的な `z-10` は対象外。
 * あれは自分の親の中の重なり順で、画面に固定される面とは competing しない
 * (例: `components/layout/hero-section.tsx` の `relative z-10`、
 * `components/viz/**` のツールチップ、`components/ui/**` の
 * `focus-visible:z-10`)。全面禁止にすると無関係な指摘で埋まって番人が死ぬので、
 * **`fixed` / `sticky` と同居する生スケール**だけを見る。
 */

const ROOT = resolve(__dirname, "../..");
const GLOBALS_CSS = join(ROOT, "app/globals.css");

/** 固定面でも生スケールを使ってよい場所 (理由は各ファイルのコメントにある)。 */
const FIXED_Z_ALLOWLIST = [
  // shadcn 上流のまま。ブリッジで名前付きレイヤーへ繋ぐので編集しない。
  "components/ui/",
  // 本文より前・ヘッダーより後ろ。常設 UI の段 (1020 以上) には載せない面。
  "components/journal/reading-progress.tsx",
  // 実装確認用のプレビュー面。本番の重なりに関与しない。
  "app/dev/",
  // Storybook の story は部品単体を並べる面で、下端固定 UI が居ない。
  ".stories.tsx",
];

const SCAN_DIRS = ["app", "components", "stories"];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * コメントを空白に潰す。
 *
 * この方針の説明文そのものが生スケールに言及する (「生の `z-40` は 1020 に
 * 負ける」等) ため、コメントを読むと自分の説明で赤くなる。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) =>
      lead + match.slice(lead.length).replace(/[^\n]/g, " "),
    );
}

function isAllowlisted(relPath: string): boolean {
  return FIXED_Z_ALLOWLIST.some((allowed) => relPath.includes(allowed));
}

/**
 * `@layer` ブロックの外にある宣言だけを残す。
 *
 * cascade layer に属さない宣言はどの `@layer` の中身よりも強い。ブリッジが
 * 効くのはこの位置に居るときだけなので、位置そのものを検査する。
 */
function stripLayerBlocks(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const layerAt = css.indexOf("@layer", index);
    if (layerAt === -1) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, layerAt);
    const braceAt = css.indexOf("{", layerAt);
    if (braceAt === -1) break;
    // `@layer a, b;` のような宣言だけの行はブロックを持たない。
    const semicolonAt = css.indexOf(";", layerAt);
    if (semicolonAt !== -1 && semicolonAt < braceAt) {
      index = semicolonAt + 1;
      continue;
    }
    let depth = 1;
    let cursor = braceAt + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    index = cursor;
  }
  return out;
}

describe("z layer single source", () => {
  const globals = readFileSync(GLOBALS_CSS, "utf8");

  it("名前付きレイヤーが 4 段そろっている", () => {
    for (const [name, value] of [
      ["--z-sticky", "1020"],
      ["--z-chat", "1030"],
      ["--z-overlay", "1040"],
      ["--z-modal", "1050"],
    ] as const) {
      expect(globals, `${name} が app/globals.css に無い`).toContain(
        `${name}: ${value};`,
      );
    }
  });

  it("components/ui の生 z-50 を名前付きレイヤーへ繋ぐブリッジが cascade layer の外にある", () => {
    const unlayered = stripLayerBlocks(globals);
    const bridge = /\.z-50\s*\{[^}]*z-index:\s*var\(--z-modal\)[^}]*\}/;
    expect(
      bridge.test(unlayered),
      "`.z-50 { z-index: var(--z-modal) }` が @layer の外に見つからない。" +
        "@layer の中に入れると Lightning CSS に落とされる / 組込みの z-index:50 に負けるため、" +
        "cascade layer 無所属で書くこと。",
    ).toBe(true);
  });

  it("ブリッジが効かない variant 形の z-50 が無い", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(join(ROOT, dir))) {
        const relPath = relative(ROOT, file);
        stripComments(readFileSync(file, "utf8"))
          .split("\n")
          .forEach((line, lineIndex) => {
            for (const match of line.matchAll(/[a-z0-9][\w.-]*:z-50\b/g)) {
              offenders.push(`${relPath}:${lineIndex + 1} \`${match[0]}\``);
            }
          });
      }
    }
    expect(
      offenders,
      "variant 形の z-50 は素の `.z-50` ブリッジを通らないので 50 のまま残り、" +
        "下端固定 UI (--z-sticky 1020) に負ける。z-(--z-modal) を直接書くこと。\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("画面に固定される面が生スケールの z を持たない", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(join(ROOT, dir))) {
        const relPath = relative(ROOT, file);
        if (isAllowlisted(relPath)) continue;
        stripComments(readFileSync(file, "utf8"))
          .split("\n")
          .forEach((line, lineIndex) => {
            if (!/\b(fixed|sticky)\b/.test(line)) return;
            const match = line.match(/(?:^|[\s"'`])(z-\d+)\b/);
            if (match) {
              offenders.push(
                `${relPath}:${lineIndex + 1} \`${match[1]}\` — z-(--z-*) を使うこと`,
              );
            }
          });
      }
    }
    expect(
      offenders,
      "固定面の z は名前付きレイヤーから採る (生スケールは 50 < --z-sticky 1020 で必ず負ける)。\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
