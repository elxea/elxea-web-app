/**
 * `public/content-keys.json` (社内ツールが読む配信物) の契約テスト。
 *
 * この配信物は **サイトのパスワード門を素通りして誰でも読める** (middleware の
 * matcher が拡張子付き path を対象から外しているため)。よってここで守るのは 2 つ:
 *
 *   A. 中身が漏れないこと — 元の値も、型の別も、内訳も読み取れない。
 *      合言葉を知らない相手が候補語を総当たりしても当たらない。
 *   B. それでも SoT と一致していること — 1 件足して作り直し忘れたら build が落ちる。
 *
 * A が緩むと「どの書類を伏せているか」の一覧を自分でネットに置くことになる。
 * B が緩むと社内ツールだけが古い表を読み、伏せたはずの枠が出続ける。
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  FICTIONAL_DOC_TYPES,
  fictionalIds,
  fictionalSlugs,
} from "@/lib/fictional-content";
import {
  CONTENT_KEYS_PATH,
  CONTENT_KEYS_SCHEMA_VERSION,
  SECRET_ENV,
  buildContentKeysDocument,
  contentKey,
  renderContentKeysJson,
  requireSecret,
  sourceEntryCount,
} from "@/scripts/gen-content-keys";
import { checkContentKeys } from "@/scripts/check-content-keys";

const raw = readFileSync(CONTENT_KEYS_PATH, "utf8");
const published = JSON.parse(raw) as { version: number; keys: string[] };
const TEST_SECRET = "test-secret-not-the-real-one";

/** 実際に本番へ出る全文字列 (コメントを含む)。 */
const publishedText = raw;

describe("公開される配信物から中身が読めないこと", () => {
  it("元の値 (slug / _id / 題) が 1 つも載っていない", () => {
    for (const type of FICTIONAL_DOC_TYPES) {
      for (const v of [...fictionalIds(type), ...fictionalSlugs(type)]) {
        expect(publishedText).not.toContain(v);
      }
    }
  });

  it("型の名前も、何の一覧かを示す語も載っていない", () => {
    for (const word of [
      ...FICTIONAL_DOC_TYPES,
      "fictional",
      "作り話",
      "架空",
      "ダミー",
      "dummy",
      "非表示",
      "deny",
      "slug",
    ]) {
      expect(publishedText).not.toContain(word);
    }
  });

  it("要素は固定長の符号だけ (元の値の断片が混ざらない)", () => {
    expect(published.keys.length).toBeGreaterThan(0);
    for (const k of published.keys) expect(k).toMatch(/^[0-9a-f]{32}$/);
  });

  it("件数の内訳 (型ごとに何件か) が読み取れない", () => {
    // 全部で何件かは分かるが、それが何の何件かは分からない。
    expect(Object.keys(published)).toEqual(
      expect.arrayContaining(["version", "keys"]),
    );
    expect(JSON.stringify(published)).not.toMatch(/farmer|event|teaMenu/);
  });

  it("候補語の総当たりでは当たらない (合言葉なしのハッシュではない)", () => {
    // 攻撃者が正解の候補語を全部知っていても、合言葉が違えば符号は一致しない。
    const guesses = new Set<string>();
    for (const type of FICTIONAL_DOC_TYPES) {
      for (const v of [...fictionalIds(type), ...fictionalSlugs(type)]) {
        guesses.add(contentKey("wrong-secret", type, v));
        guesses.add(createHmac("sha256", "").update(`${type}:${v}`).digest("hex").slice(0, 32));
      }
    }
    for (const g of guesses) expect(published.keys).not.toContain(g);
  });

  it("同じ値でも型が違えば別の符号になる", () => {
    expect(contentKey(TEST_SECRET, "farmer", "x")).not.toBe(
      contentKey(TEST_SECRET, "event", "x"),
    );
  });
});

describe("配信物が SoT と一致していること", () => {
  it("件数が SoT と合う", () => {
    expect(published.keys.length).toBe(sourceEntryCount());
    expect(published.version).toBe(CONTENT_KEYS_SCHEMA_VERSION);
  });

  it("ビルドゲートを通る", () => {
    expect(checkContentKeys()).toEqual([]);
  });

  it("1 件足して作り直さないと落ちる (件数検査は合言葉なしでも効く)", () => {
    // 合言葉を渡さない環境でも、件数のズレは捕まる。
    const tmp = path.join(path.dirname(CONTENT_KEYS_PATH), ".content-keys.test.json");
    const shortened = {
      ...published,
      keys: published.keys.slice(0, published.keys.length - 1),
    };
    const { writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(tmp, `${JSON.stringify(shortened, null, 2)}\n`, "utf8");
    try {
      const errors = checkContentKeys(tmp, {});
      expect(errors.join(" ")).toContain("件数が合わない");
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  it("元の値を生で載せた配信物はゲートで落ちる", () => {
    const tmp = path.join(path.dirname(CONTENT_KEYS_PATH), ".content-keys.raw.json");
    const leaky = { version: CONTENT_KEYS_SCHEMA_VERSION, keys: ["sato-misaki"] };
    const { writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(tmp, `${JSON.stringify(leaky, null, 2)}\n`, "utf8");
    try {
      expect(checkContentKeys(tmp, {}).join(" ")).toContain("符号の形をしていない");
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});

describe("合言葉の扱い", () => {
  it("合言葉が無ければ符号表を作らない (弱い符号に落とさない)", () => {
    expect(() => requireSecret({})).toThrow(SECRET_ENV);
    expect(() => requireSecret({ [SECRET_ENV]: "  " })).toThrow(SECRET_ENV);
  });

  it("合言葉が変われば符号もすべて変わる", () => {
    const a = buildContentKeysDocument("secret-a").keys;
    const b = buildContentKeysDocument("secret-b").keys;
    expect(a).toHaveLength(b.length);
    expect(a.filter((k) => b.includes(k))).toEqual([]);
  });

  it("同じ合言葉なら何度作っても同じ (build が毎回差分を出さない)", () => {
    expect(renderContentKeysJson(TEST_SECRET)).toBe(renderContentKeysJson(TEST_SECRET));
  });
});
