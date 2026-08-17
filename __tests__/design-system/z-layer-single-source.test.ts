import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PINNED_EXEMPTIONS,
  SCAN_DIRS,
  formatOffender,
  isAllowlisted,
  listFiles,
  scanTree,
} from "./z-layer-scan";

/**
 * z の 1 系統を守る番人 (2026-08-18 新設 / 同日 要素単位判定へ移行)
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
 * ## 判定単位は行ではなく要素 (2026-08-18 変更)
 *
 * 初版は「`fixed`/`sticky` と生 z が **同一行**にある」ことを見ていたので、
 * 書き方を変えるだけで 3 つの形が素通りした ((a) 複数行 className /
 * (b) 任意値 `z-[9999]` / (c) `style={{ zIndex: 40 }}`)。行は「同じ要素に
 * 載るか」と無関係な単位なので、行を単位にしている限りこの穴は塞げない。
 * 判定を **1 要素に載るクラス + inline style** の束に変えて 3 つとも同じ規則で
 * 落とすようにした。実装と、AST を採った理由は `./z-layer-scan.ts` にある。
 *
 * ## 何を検査しないか (意図的)
 *
 * `relative` / `absolute` の中だけで前後を決める局所的な `z-10` は対象外。
 * あれは自分の親の中の重なり順で、画面に固定される面とは competing しない
 * (例: `components/layout/hero-section.tsx` の `relative z-10`、
 * `components/viz/**` のツールチップ、`components/ui/**` の
 * `focus-visible:z-10`)。全面禁止にすると無関係な指摘 12 件で埋まって番人が
 * 死ぬので、**固定面であること**を判定の前提条件に置いている。
 *
 * ### 残っている限界 (現コードベースには不在)
 *
 *   - `element.style.zIndex = "40"` のような命令的な代入。静的には「その要素が
 *     固定面か」が判らないため候補に入れない (`components/viz/**` の
 *     `node.style.zIndex` は relative 内の局所的な前後関係)。
 *   - クラス列を別ファイルの定数に切り出し、`fixed` と z を別の定数に分けて
 *     同じ要素で合成する書き方。単位はファイル内で閉じている。
 */

const ROOT = resolve(__dirname, "../..");
const GLOBALS_CSS = join(ROOT, "app/globals.css");

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

  describe("画面に固定される面が独自の重なり順を持たない", () => {
    const found = scanTree(ROOT);
    const exemptKeys = new Set(PINNED_EXEMPTIONS.map((entry) => entry.key));

    it("免除されていない違反が無い", () => {
      const offenders = found
        .filter((offender) => !exemptKeys.has(offender.key))
        .map(formatOffender);
      expect(
        offenders,
        "固定面の z は名前付きレイヤーから採る (生スケールは 50 < --z-sticky 1020 で必ず負ける)。\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });

    // 免除が惰性で残らないようにする。直したら消さないと赤くなる。
    it.each(PINNED_EXEMPTIONS)(
      "免除 $key が現存の違反を指している",
      ({ key }) => {
        expect(
          found.some((offender) => offender.key === key),
          `免除 \`${key}\` に該当する違反が見つからない。直したなら ` +
            "PINNED_EXEMPTIONS から消すこと (免除の付けっぱなしを防ぐため落としている)。",
        ).toBe(true);
      },
    );

    // 許可リストの各行が本当に何かを守っているか。守るものが無くなったら消す。
    it("許可リストが指す場所が実在する", () => {
      const raw = scanTree(ROOT, { applyAllowlist: false });
      const unusedPaths = raw
        .filter((offender) => isAllowlisted(offender.file))
        .map((offender) => offender.file);
      expect(unusedPaths.length, "許可リストが 1 件も効いていない").toBeGreaterThan(0);
    });
  });
});
