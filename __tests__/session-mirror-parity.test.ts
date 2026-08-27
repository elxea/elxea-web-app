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

import { canRenderAccountShell } from "@/lib/account-capabilities";
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

/**
 * マイページが骨格を描き始めるまでの判定を、**ページと同じ順で**組んで確かめる。
 *
 * `app/[locale]/account/page.tsx` は cookie を
 * `readSessionMirror` → `canRenderAccountShell` の順に通して「骨格を出すか、
 * ログインを促す画面に落とすか」を決める。ここではその 2 段をそのまま合成する。
 *
 * 関数単体のテスト (上の describe) では足りない: 割れていたのは
 * **合成の仕方**だったから。`hasShopifySessionCookies` は当時も正しく
 * `shop_rt` だけを見ていて、ページがそれを呼ばずに自前で
 * `shop_at && shop_rt` を書いていた。部品が正しくても、繋ぎ方が違えば症状は出る。
 */
function accountShellVisible(...present: string[]): boolean {
  const mirror = readSessionMirror(jar(...present));
  return canRenderAccountShell({
    hasShopifySession: mirror.shopify,
    hasLineSession: mirror.line,
    previewSeed: false,
  });
}

describe("マイページの骨格が出る条件", () => {
  it("shop_at が無くても shop_rt があれば骨格が出る (回帰: 門は通るのに画面だけ落ちる)", () => {
    /* これが直した症状そのもの。`shop_at` はアクセストークンの寿命 (数時間) で
       ブラウザから消えるが、ログインが続くかを決めるのは 30 日の `shop_rt`。
       middleware はこの人を /account へ通すので、ここで false を返すと
       「ログインし直しても同じ画面に戻る」堂々巡りになる。 */
    expect(accountShellVisible(COOKIE_NAME.shopRefreshToken)).toBe(true);
  });

  it("shop_at と shop_rt が揃っていれば当然出る", () => {
    expect(
      accountShellVisible(COOKIE_NAME.shopAccessToken, COOKIE_NAME.shopRefreshToken),
    ).toBe(true);
  });

  it("shop_at だけでは出ない (アクセストークンだけの人はログイン継続とみなさない)", () => {
    /* 逆方向の固定。`shop_rt` を落として `shop_at` に寄せる、という誤った
       「修正」で上のテストを通されないようにする。 */
    expect(accountShellVisible(COOKIE_NAME.shopAccessToken)).toBe(false);
  });

  it("LINE だけで入っている人にも骨格が出る", () => {
    expect(accountShellVisible(COOKIE_NAME.lineSession)).toBe(true);
  });

  it("cookie が 1 つも無ければ出ない", () => {
    expect(accountShellVisible()).toBe(false);
  });

  it("門が通す人には必ず骨格が出る (middleware との一致)", () => {
    /* middleware は `!shopify && !line` でリダイレクトする。
       「門を通ったのに骨格が出ない」組み合わせが 1 つも無いことを、
       関係する cookie の全 8 通りで確かめる。 */
    const names = [
      COOKIE_NAME.shopAccessToken,
      COOKIE_NAME.shopRefreshToken,
      COOKIE_NAME.lineSession,
    ];
    for (let mask = 0; mask < 8; mask += 1) {
      const present = names.filter((_, i) => mask & (1 << i));
      const mirror = readSessionMirror(jar(...present));
      const middlewareLetsThrough = mirror.shopify || mirror.line;
      expect(
        accountShellVisible(...present),
        `cookie=[${present.join(",")}] で門と画面が食い違っている`,
      ).toBe(middlewareLetsThrough);
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

  it("マイページが shop_at と shop_rt の AND を自前で書いていない", () => {
    /* 旧判定 `cookieStore.has("shop_at") && cookieStore.has("shop_rt")` の形を
       名指しで塞ぐ。上の合成テストは「今の配線が正しいこと」を見るが、誰かが
       共通関数を呼びつつ **AND を足し戻す** と合成テストは通ってしまう
       (readSessionMirror は呼ばれているので)。書き戻しの形そのものを止める。 */
    const code = read("app/[locale]/account/page.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/hasShopifySession\s*&&/);
    expect(code).not.toMatch(/shopAccessToken[\s\S]{0,80}&&[\s\S]{0,80}shopRefreshToken/);
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
