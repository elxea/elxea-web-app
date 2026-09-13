/**
 * gen-content-keys.ts
 *
 * `lib/fictional-content.ts` (SoT) から `public/content-keys.json` を作る。
 *
 * 何のためのファイルか
 * --------------------
 * 社内ツール (elxea-asset-hub) は Sanity を直接読むため、このサイトが読み取り層で
 * 伏せている書類も「写真の空き枠」として並べてしまう。それを止めるには、
 * **どの書類を伏せているか**を社内ツールへ伝える必要がある。
 *
 * ただし配信先は公開されている
 * ----------------------------
 * `middleware.ts` の matcher は拡張子付き path (`.*\..*`) を対象から外すので、
 * `public/` の JSON は**サイトのパスワード門を素通りして誰でも読める**
 * (`site-slots.manifest.json` が本番で 200 で取れるのと同じ理由)。
 * よって **名前 (slug) や題をそのまま置かない**。置けば「どの書類を伏せているか」の
 * 一覧を自分でネットに公開することになる。
 *
 * そこで配信するのは **共有の合言葉を混ぜた不可逆な符号 (HMAC-SHA256) だけ**:
 *
 *   token = HMAC(合言葉, `${_type}:${値}`) の先頭 128bit を hex 表記
 *
 *   - 合言葉を知らなければ元の値は復元できない (一方向)
 *   - **候補語の総当たりでも当たらない** (合言葉が無いと候補の符号を計算できない)
 *   - `_type` を混ぜてあるので、型をまたいだ一致は起きない
 *   - 並びは昇順に固定。件数以外は何も漏れない (型の別も件数の内訳も出さない)
 *
 * 合言葉は `CONTENT_KEYS_SECRET` (環境変数)。**リポジトリにも配信物にも置かない。**
 * このスクリプトは合言葉が無ければ何も書かずに落ちる。
 *
 *   pnpm generate:content-keys  ... 生成 (SoT を編集したら必ず走らせる)
 *   pnpm check:content-keys     ... 一致検査 (build の前段でも走る)
 *
 * **新しい CI ジョブは足していない** ので GitHub Actions の実行時間は増えない。
 *
 * Exit codes: 0 = 生成成功 / 1 = 失敗
 */

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  FICTIONAL_DOC_TYPES,
  fictionalIds,
  fictionalSlugs,
  type FictionalDocType,
} from "../lib/fictional-content";

const ROOT = path.resolve(__dirname, "..");
export const CONTENT_KEYS_PATH = path.join(ROOT, "public", "content-keys.json");

/** 合言葉を入れる環境変数の名前 (値そのものはどこにも書かない)。 */
export const SECRET_ENV = "CONTENT_KEYS_SECRET";

/**
 * この JSON の**書き方**の版。中身が 1 件増えたくらいでは上げない。
 * 読み手 (社内ツール) はこれを**スキーマ版**として扱う。
 * v1 は値をそのまま載せていた形 (公開されるため廃止)。v2 が符号だけの形。
 */
export const CONTENT_KEYS_SCHEMA_VERSION = 2;

/** 符号の長さ (hex 文字数)。128bit。 */
const TOKEN_HEX_LEN = 32;

const COMMENT: readonly string[] = [
  "content-keys.json — サイトと社内ツールが照合に使う符号表。",
  "",
  "【手で編集しない】",
  "elxea-web-app の生成物。pnpm generate:content-keys で作り直す。",
  "pnpm check:content-keys が build の前段で食い違いを落とす。",
  "",
  "【中身について】",
  "各要素は合言葉を混ぜた一方向の符号で、元の値は復元できない。",
  "照合する側も同じ合言葉を持っていないと何とも突き合わせられない。",
];

/** 合言葉を読む。無ければ throw (黙って弱い符号を作らない)。 */
export function requireSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env[SECRET_ENV];
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error(
      `${SECRET_ENV} が設定されていません。合言葉が無いと符号表は作れません ` +
        `(値はリポジトリに置かず、デプロイ先の環境変数として設定すること)`,
    );
  }
  return secret;
}

/** 1 件ぶんの符号。`_type` を混ぜるので型をまたいだ一致は起きない。 */
export function contentKey(secret: string, type: string, value: string): string {
  return createHmac("sha256", secret)
    .update(`${type}:${value}`)
    .digest("hex")
    .slice(0, TOKEN_HEX_LEN);
}

/** SoT に載っている `(型, 値)` の総数。合言葉が無くても数えられる。 */
export function sourceEntryCount(): number {
  return FICTIONAL_DOC_TYPES.reduce(
    (n, t) => n + fictionalIds(t).size + fictionalSlugs(t).size,
    0,
  );
}

export interface ContentKeysDocument {
  $comment: readonly string[];
  version: number;
  generatedBy: string;
  keys: string[];
}

/** SoT を読んで配信用の形に組み立てる (書き込みはしない)。 */
export function buildContentKeysDocument(secret: string): ContentKeysDocument {
  const keys = new Set<string>();
  for (const type of FICTIONAL_DOC_TYPES as readonly FictionalDocType[]) {
    for (const id of fictionalIds(type)) keys.add(contentKey(secret, type, id));
    for (const slug of fictionalSlugs(type)) keys.add(contentKey(secret, type, slug));
  }
  return {
    $comment: COMMENT,
    version: CONTENT_KEYS_SCHEMA_VERSION,
    generatedBy: "scripts/gen-content-keys.ts",
    // 昇順固定。並びから型や登録順が読めないようにする。
    keys: [...keys].sort(),
  };
}

/** 生成物の中身 (末尾改行まで)。テストから比較できるよう分離。 */
export function renderContentKeysJson(secret: string): string {
  return `${JSON.stringify(buildContentKeysDocument(secret), null, 2)}\n`;
}

function main(): void {
  const secret = requireSecret();
  writeFileSync(CONTENT_KEYS_PATH, renderContentKeysJson(secret), "utf8");
  console.log(
    `content-keys: generated ${path.relative(ROOT, CONTENT_KEYS_PATH)} ` +
      `(${sourceEntryCount()} entries)`,
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
