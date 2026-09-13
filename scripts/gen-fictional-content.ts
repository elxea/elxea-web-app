/**
 * gen-fictional-content.ts
 *
 * `lib/fictional-content.ts` (SoT) を `public/fictional-content.json` に写す。
 *
 * なぜ配信するのか
 * ----------------
 * このサイトには「作り話なので表に出さない」ドキュメントの deny-list があり、
 * 読み取り層 (`filterOutFictional`) がそれを使って非表示にしている。ところが
 * **アセットハブ (elxea-asset-hub) は Sanity を直接読む**ため、この deny-list を
 * 知らないまま「サイトに出す枠」を並べてしまう。結果、本番で 404 のページの
 * 写真枠が空き枠として出る (2026-09-14 に生産者 4 件 / イベント 4 件で発覚)。
 *
 * 直し方の向きは `public/site-slots.manifest.json` と同じ:
 * **サイトが宣言し、アセットハブがそれを読む**。deny-list の中身をアセットハブ側に
 * 複製しない (単一正本)。middleware の matcher は `.*\..*` を除外するので、この
 * JSON はサイトパスワード門を素通りして公開配信される
 * (`site-slots.manifest.json` が本番で 200 で取れているのと同じ理由)。
 *
 * 向きが site-slots と逆である点に注意
 * ------------------------------------
 *   site-slots ... JSON が SoT → TS を生成
 *   ここ       ... TS が SoT  → JSON を生成
 * deny-list は「なぜこの 1 件を隠すのか」の判断経緯 (Setaka の確認日・据え置きの
 * 決定) が本体で、それは TS の doc comment にしか書けない。よって TS を正本に保つ。
 *
 *   pnpm generate:fictional-content  ... 生成 (deny-list を編集したら必ず走らせる)
 *   pnpm check:fictional-content     ... 一致検査 (build の前段でも走る)
 *
 * **新しい CI ジョブは足していない** ので GitHub Actions の実行時間は増えない。
 *
 * Exit codes: 0 = 生成成功 / 1 = 失敗
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  FICTIONAL_DOC_TYPES,
  fictionalIds,
  fictionalSlugs,
  type FictionalDocType,
} from "../lib/fictional-content";

const ROOT = path.resolve(__dirname, "..");
export const FICTIONAL_JSON_PATH = path.join(
  ROOT,
  "public",
  "fictional-content.json",
);

/**
 * この JSON の**書き方**の版。deny-list に 1 件足した・消したでは上げない
 * (`site-slots.manifest.json` の version と同じ約束)。上げてよいのは項目の追加や
 * 意味の変更でスキーマそのものが変わったときだけ。読み手 (アセットハブ) は
 * これを**スキーマ版**として扱う。
 */
export const FICTIONAL_CONTENT_SCHEMA_VERSION = 1;

const COMMENT: readonly string[] = [
  "fictional-content.json — 本番サイトが「作り話なので表に出さない」ドキュメントの一覧。",
  "",
  "【この JSON を手で編集しない】",
  "正本は elxea-web-app の lib/fictional-content.ts。隠す理由・確認日・据え置きの判断は",
  "すべてそちらの doc comment にある。編集したら pnpm generate:fictional-content を走らせる。",
  "食い違ったまま本番に出ないよう pnpm check:fictional-content が build の前段で落とす。",
  "",
  "【誰が読むか】",
  "elxea-asset-hub。Sanity を直接読むため、このファイルを読まないと本番に無いページの",
  "写真枠を『空き枠』として並べてしまう。deny-list の中身をアセットハブ側に複製しない。",
  "",
  "【読み手への約束】",
  "docTypes のキーが『このサイトが deny-list を持っている _type』の全体。",
  "ここに無い _type (author / journal / playlist 等) は、隠す対象がそもそも無いという意味で、",
  "『まだ調べていない』ではない。ids と slugs は同じ 1 件を両方から引けるようにしたもの",
  "(一覧は _id を持ち、詳細ルートと sitemap は slug しか持たないため)。",
  "",
  "【version はスキーマの版であって中身の版ではない】",
  "deny-list に 1 件足す・消すでは上げない。上げてよいのはこの JSON の書き方を変えたときだけ。",
];

export interface FictionalContentDocument {
  $comment: readonly string[];
  version: number;
  generatedBy: string;
  generatedFrom: string;
  docTypes: Record<string, { ids: string[]; slugs: string[] }>;
}

/** SoT を読んで配信用の形に組み立てる (書き込みはしない)。 */
export function buildFictionalContentDocument(): FictionalContentDocument {
  const docTypes: Record<string, { ids: string[]; slugs: string[] }> = {};
  for (const type of FICTIONAL_DOC_TYPES as readonly FictionalDocType[]) {
    docTypes[type] = {
      ids: [...fictionalIds(type)].sort(),
      slugs: [...fictionalSlugs(type)].sort(),
    };
  }
  return {
    $comment: COMMENT,
    version: FICTIONAL_CONTENT_SCHEMA_VERSION,
    generatedBy: "scripts/gen-fictional-content.ts",
    generatedFrom: "lib/fictional-content.ts",
    docTypes,
  };
}

/** 生成物の中身 (末尾改行まで含む)。テストから比較できるよう分離。 */
export function renderFictionalContentJson(): string {
  return `${JSON.stringify(buildFictionalContentDocument(), null, 2)}\n`;
}

function main(): void {
  const source = renderFictionalContentJson();
  writeFileSync(FICTIONAL_JSON_PATH, source, "utf8");
  const total = FICTIONAL_DOC_TYPES.reduce(
    (n, t) => n + fictionalIds(t).size + fictionalSlugs(t).size,
    0,
  );
  console.log(
    `fictional-content: generated ${path.relative(ROOT, FICTIONAL_JSON_PATH)} ` +
      `(${FICTIONAL_DOC_TYPES.length} types / ${total} keys)`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
