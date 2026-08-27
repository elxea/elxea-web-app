/**
 * 設計憲章 (`docs/architecture/constitution.md`) が**嘘をつかない**ことを確かめる。
 *
 * ## なぜ要るか
 *
 * 憲章のスキーマは「強制機構が空の原則は載せない」と決めている。これは
 * 「文書だけの規律」が復活するのを防ぐための一番大事な取り決めなのだが、
 * **書いたパスが実在するかどうかは誰も見ていなかった**。ファイルを移動・改名した
 * 瞬間に、憲章は「機械が守っている」と書いてあるのに何も守っていない文書になる。
 * しかもその状態は、憲章を読んだ人には見分けがつかない。
 *
 * だから憲章に書かれたパスを全部拾って、実在を検査する。R5 の
 * `check-sot-registry.mjs` が「正本を自称させない」のと同じ考え方で、
 * ここは**強制機構を自称させない**。
 *
 * 憲章そのものが 2026-08-27 まで作られていなかった (「ここに置く」と決めた
 * まま 1 年近く不在だった) ので、不在も検知する。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const CHARTER = join(REPO, "docs/architecture/constitution.md");

describe("設計憲章", () => {
  it("正本のファイルが存在する", () => {
    expect(
      existsSync(CHARTER),
      "docs/architecture/constitution.md が無い。憲章の置き場はここと決まっている " +
        "(Notion には写しを作らない)。",
    ).toBe(true);
  });

  const text = existsSync(CHARTER) ? readFileSync(CHARTER, "utf8") : "";

  /**
   * 表の中の `` `path` `` を全部拾う。
   *
   * バッククォートで囲まれていて、かつ**リポジトリ内のパスに見えるもの**だけを
   * 対象にする (`ratchets.json` の `silent-catch-grandfathered` のようなキー名は
   * パスではないので拾わない)。判定はスラッシュを含むか、既知の直下ファイル名か。
   */
  const ROOT_FILES = new Set([
    "ratchets.json",
    "eslint.config.mjs",
    "eslint-suppressions.json",
    "interaction-inventory.json",
    "package.json",
    "playwright.config.ts",
  ]);

  const claimed = [...text.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1])
    .filter((token) => ROOT_FILES.has(token) || /^[a-z_.]+[a-zA-Z0-9_./[\]-]*\/[^`\s]+$/.test(token))
    .filter((token) => /\.(ts|tsx|mjs|json|md)$/.test(token))
    /* `lib/**` のようなワイルドカード表記は道ではなく範囲の説明。 */
    .filter((token) => !token.includes("*"))
    .filter((token, i, all) => all.indexOf(token) === i)
    .sort();

  it("パスを 1 つ以上主張している (正規表現が空振りしていない)", () => {
    /* ここが 0 件だと、下の検査は「何も見ずに緑」になる。
       表の書き方が変わって拾えなくなった状態を、成功と読まない。 */
    expect(claimed.length).toBeGreaterThan(15);
  });

  it.each(claimed)(
    "憲章が名指しした %s が実在する",
    (path: string) => {
      expect(
        existsSync(join(REPO, path)),
        `憲章 (docs/architecture/constitution.md) が \`${path}\` を強制機構・例外表・` +
          "配線assert として名指ししているが、実在しない。移動・改名したなら憲章も直す。" +
          "実在しない道を書いた憲章は、守っているつもりの文書でしかない。",
      ).toBe(true);
    },
  );

  it("R9 が 6 欄すべてを持つ", () => {
    const r9 = text.slice(text.indexOf("## R9."));
    expect(r9.length, "R9 の節が無い").toBeGreaterThan(0);
    for (const field of ["**id**", "**一言**", "**強制機構**", "**例外表**", "**配線assert**"]) {
      expect(r9, `R9 に ${field} 欄が無い`).toContain(field);
    }
    /* 「実障害」はスキーマ上の欄名で、R9 では見出しとして立てている。 */
    expect(r9).toContain("実障害");
  });

  it("R1〜R9 が漏れなく載っている", () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(text, `R${n} が憲章に無い`).toMatch(new RegExp(`\\bR${n}\\b`));
    }
  });
});
