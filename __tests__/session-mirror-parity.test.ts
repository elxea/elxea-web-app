/**
 * 門 (`middleware.ts`) と画面が、ログイン状態を**同じ 1 実装**で判定することを固定する。
 *
 * ## なぜ要るのか (実際に割れていた)
 *
 * 判定は 1 行なので「揃っているだろう」と思われがちだが、このリポジトリでは 2 回割れている。
 *
 *  1. as-is D-1 — 門と `lib/shopify` がどちらも `shop_at` を要求していた。`shop_at` は
 *     アクセストークンの寿命 (数時間) で消えるので、30 日の `shop_rt` を持つ人まで
 *     ログイン画面へ弾かれた。門側は `hasShopifySessionCookies` に寄せて直した。
 *  2. Wave 4 の棚卸しで見つかった残り — `app/[locale]/account/page.tsx` が
 *     **「middleware と同じ cookie・同じ条件」と註釈しながら** `shop_at && shop_rt` を
 *     要求していた。つまり (1) を直したとき、こちらが取り残されていた。症状は
 *     「門は通るのにマイページだけ『ログインが必要です』に落ちる」。
 *
 * どちらも註釈は「揃っている」と言っていて、コードは揃っていなかった。だから
 * **註釈ではなく、同じ関数を呼んでいることを機械で確かめる**。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COOKIE_NAME,
  hasLineSessionCookies,
  hasShopifySessionCookies,
  readSessionMirror,
} from "@/lib/auth/cookies";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** cookie の有無を答える関数を、名前の集合から作る。 */
const jar = (...present: string[]) => (name: string) => present.includes(name);

describe("判定そのもの", () => {
  it("Shopify は shop_rt だけで決まる (shop_at は無関係)", () => {
    expect(hasShopifySessionCookies(jar(COOKIE_NAME.shopRefreshToken))).toBe(true);
    /* これが (2) の再発検出。`shop_at` が消えても、リフレッシュトークンが
       あるかぎりログインは続いている。 */
    expect(hasShopifySessionCookies(jar(COOKIE_NAME.shopAccessToken))).toBe(false);
    expect(hasShopifySessionCookies(jar())).toBe(false);
  });

  it("LINE は line_session だけで決まる (line_user は無関係)", () => {
    expect(hasLineSessionCookies(jar(COOKIE_NAME.lineSession))).toBe(true);
    /* 表示名 cookie だけが残った状態を「ログイン中」と読まない。 */
    expect(hasLineSessionCookies(jar(COOKIE_NAME.lineUser))).toBe(false);
    expect(hasLineSessionCookies(jar())).toBe(false);
  });

  it("値を返す関数を渡しても動く (有無でも値でも同じ答え)", () => {
    const byValue = (name: string) =>
      name === COOKIE_NAME.lineSession ? "1" : undefined;
    expect(hasLineSessionCookies(byValue)).toBe(true);
  });

  it("readSessionMirror は 2 つの判定をそのまま束ねる", () => {
    expect(readSessionMirror(jar(COOKIE_NAME.shopRefreshToken))).toEqual({
      shopify: true,
      line: false,
    });
    expect(readSessionMirror(jar(COOKIE_NAME.lineSession))).toEqual({
      shopify: false,
      line: true,
    });
    expect(
      readSessionMirror(jar(COOKIE_NAME.shopRefreshToken, COOKIE_NAME.lineSession)),
    ).toEqual({ shopify: true, line: true });
    expect(readSessionMirror(jar())).toEqual({ shopify: false, line: false });
  });

  it("門を通る条件と画面を描き始める条件が一致する", () => {
    /* middleware は `!shopify && !line` でリダイレクトする。画面側は
       `shopify || line` で骨格を出す。同じ入力に対して裏返しの関係が
       崩れていないことを、全 4 通りで確かめる。 */
    for (const present of [
      [],
      [COOKIE_NAME.shopRefreshToken],
      [COOKIE_NAME.lineSession],
      [COOKIE_NAME.shopRefreshToken, COOKIE_NAME.lineSession],
    ]) {
      const mirror = readSessionMirror(jar(...present));
      const middlewareRedirects = !mirror.shopify && !mirror.line;
      const pageRendersShell = mirror.shopify || mirror.line;
      expect(middlewareRedirects).toBe(!pageRendersShell);
    }
  });
});

describe("変異: 判定が呼び出し側に散らばっていないか", () => {
  /**
   * 「同じ関数を呼んでいること」をソースで確かめる。挙動テストだけでは、
   * 誰かが画面側に判定を書き直しても気づけない — 関数は正しいまま、
   * 呼ばれなくなるだけだから。
   */
  const CALLERS = [
    "middleware.ts",
    "app/[locale]/account/page.tsx",
    "app/[locale]/account/subscriptions/page.tsx",
    "app/[locale]/login/page.tsx",
  ];

  it.each(CALLERS)("%s は共通判定を通している", (file) => {
    const source = read(file);
    expect(
      /readSessionMirror|hasLineSessionCookies|hasShopifySessionCookies/.test(source),
      `${file} が lib/auth/cookies の判定を呼んでいない`,
    ).toBe(true);
  });

  it.each(CALLERS)("%s に cookie 名の生文字列が無い", (file) => {
    const source = read(file);
    /* コメント・註釈の中の言及は許す (実際に註釈で経緯を説明している)。
       ここで止めたいのは**コードとしての**生文字列。 */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    for (const name of [
      COOKIE_NAME.lineSession,
      COOKIE_NAME.shopAccessToken,
      COOKIE_NAME.shopRefreshToken,
    ]) {
      expect(code, `${file} に生の "${name}" が残っている`).not.toContain(
        `"${name}"`,
      );
    }
  });
});
