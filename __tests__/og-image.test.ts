import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { OG_IMAGE, ogImages } from "@/lib/og-image";

/**
 * 共有カード画像 (og:image) が消えないことを守る検査。
 *
 * ## 何を守っているか
 *
 * Next.js の metadata は `openGraph` を**オブジェクト単位で置換**する。子セグメントが
 * `openGraph: { title, description }` を返すと、親レイアウトの `openGraph.images` は
 * マージされずに丸ごと消える。2026-09-11 の本番実測では、その結果として
 * **トップ `/ja` を含む主要ページの og:image が 1 つも出ていなかった**
 * (`twitter:image` だけが残っていたので、症状が中途半端で気づけなかった)。
 *
 * 目視や 1 ページのスナップショットでは同じ穴がまた開く — 新しいページを足した人が
 * `images` を書き忘れるだけで再発するからだ。よってここでは
 * **`app/` 配下の `openGraph` 宣言を全数走査**し、`images` を持たない宣言が
 * 1 つでもあれば落とす。個別ページのテストを増やす方式にしないのは、
 * 「増えたページを検査に足し忘れる」という同じ種類の穴を作らないため。
 */

const APP_DIR = join(process.cwd(), "app");

/** `app/` 配下の .tsx を全部集める。 */
function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * 1 つの `openGraph:` 宣言の中身 (対応する `{` 〜 `}`) を切り出す。
 *
 * 正規表現で 1 行だけ見る方式にしないのは、実装が複数行の宣言も
 * 1 行の宣言も両方使っているから。括弧の深さを数えて実際の範囲を取る。
 */
function openGraphBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = /openGraph:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, i + 1));
  }
  return blocks;
}

describe("og:image のフォールバック", () => {
  it("app/ 配下の openGraph 宣言はすべて images を持つ", () => {
    const offenders: string[] = [];

    for (const file of collectTsx(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("openGraph:")) continue;
      for (const block of openGraphBlocks(source)) {
        if (!/\bimages\s*:/.test(block)) {
          offenders.push(file.replace(process.cwd() + "/", ""));
        }
      }
    }

    expect(
      offenders,
      `openGraph に images が無いページがある。images を省くとレイアウトの既定ごと ` +
        `og:image が消えて共有カードの画像が出なくなる。'images: ogImages()' ` +
        `(固有画像があれば 'ogImages(url)') を足すこと。対象:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("app/ 配下の openGraph 宣言に空配列が残っていない", () => {
    /* `images: x ? [{ url: x }] : []` の形は、ドキュメントに画像が無いときに
       **空配列**を返す。空配列も og:image を消すので、`images` があるだけでは
       上のテストを通り抜けてしまう (実際 2026-09-11 時点の実装は 8 箇所が
       この形だった)。よってここでは宣言の中に**空配列リテラルが 1 つでも
       あれば落とす**。

       判定を「`? ... : []` という書き方」の正規表現にしないのは、その形を
       少し崩した書き方 (`x ? [...] : new Array()` / 変数経由 / 複数行の
       折り返し) を静かに取り逃がすから。openGraph 宣言の中に空配列が
       要る正当な理由は無いので、書き方ではなく**結果の形**を見る。 */
    const offenders: string[] = [];
    for (const file of collectTsx(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const block of openGraphBlocks(source)) {
        if (/\[\s*\]/.test(block)) {
          offenders.push(file.replace(process.cwd() + "/", ""));
        }
      }
    }
    expect(
      offenders,
      `openGraph 宣言に空配列が残っている。空配列は og:image を消すので ` +
        `'ogImages(url)' に置き換えること (引数が falsy なら既定の 1 枚に落ちる)。対象:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});

describe("ogImages()", () => {
  it("引数なしなら既定の 1 枚を返す (空配列を返さない)", () => {
    expect(ogImages()).toEqual([{ ...OG_IMAGE }]);
  });

  it("undefined / null / 空文字も既定に落とす", () => {
    for (const value of [undefined, null, ""] as const) {
      expect(ogImages(value)).toEqual([{ ...OG_IMAGE }]);
    }
  });

  it("固有 URL があればそれを使う", () => {
    expect(ogImages("https://cdn.sanity.io/x.jpg")).toEqual([
      { url: "https://cdn.sanity.io/x.jpg" },
    ]);
  });
});

describe("既定の共有カード画像の実体", () => {
  it("public/ に実ファイルがある", () => {
    // URL だけ直して実ファイルを置き忘れると、共有カードが 404 になる。
    expect(existsSync(join(process.cwd(), "public", OG_IMAGE.url.replace(/^\//, "")))).toBe(
      true,
    );
  });

  it("DS トークンの OG 寸法 (1200x630) と一致する", () => {
    const tokens = JSON.parse(
      readFileSync(join(process.cwd(), "tokens", "base.json"), "utf8"),
    );
    const flat = JSON.stringify(tokens);
    expect(flat).toContain("1200px");
    expect(flat).toContain("630px");
    expect(OG_IMAGE.width).toBe(1200);
    expect(OG_IMAGE.height).toBe(630);
  });

  it("誤カテゴリを名乗る旧 og-image.png が復活していない", () => {
    /* 旧ファイルは「elxea / Specialty Coffee & Tea」という文字だけの仮画像で、
       elxea が扱わないカテゴリ (コーヒー) を共有カードで名乗っていた。
       同名で戻すと同じ誤りが再発するので、存在そのものを落とす。 */
    expect(existsSync(join(process.cwd(), "public", "og-image.png"))).toBe(false);
  });
});
