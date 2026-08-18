import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

// next-intl の middleware 実装は内部で拡張子なしの `next/server` を import して
// おり、vitest の node 解決では読めない (`Did you mean to import
// "next/server.js"?`)。ここで検査したいのは **公開停止 locale の判定が
// next-intl へ渡る前に効くこと** なので、素通しの実装に差し替える。
// 差し替えたことで判定が甘くなっていないかは「/ja/* の挙動は変えない」
// (= next-intl 側へ抜ける) ケースで担保する。
vi.mock("next-intl/middleware", () => ({
  default: () => async () => {
    const { NextResponse } = await import("next/server");
    return NextResponse.next();
  },
}));

import {
  defaultLocale,
  disabledLocales,
  enabledLocales,
  isDisabledLocale,
  isEnabledLocale,
  locales,
} from "../i18n/config";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * コメントを落としたソース。ベタ書き検査は**実際に効くコード**だけを見たい。
 * 「旧実装は `startsWith("/en")` だった」のような説明文まで拾うと、正しく直した
 * 経緯を書き残せなくなる。
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * 英語版 (`/en/*`) を「消さずに到達不能にする」措置の検査。
 *
 * Setaka 判断 (2026-08-18)「英語版のページは今はいらない」を受けた措置で、
 * ページ・`messages/en.json`・`app/[locale]` のルートは残したまま公開だけ止めて
 * いる。この状態が崩れる壊れ方は 2 つあり、両方をここで赤くする。
 *
 *  1. 英語版が**意図せず復活**する (`enabledLocales` に "en" が戻る)
 *  2. 対応言語の定義が**また分散する** (どこかのファイルに locale をベタ書きし、
 *     `enabledLocales` を戻しても追従しない / 止めたはずが片側だけ生き残る)
 *
 * 2 が本題で、実際 2026-08-18 の本番反映では `app/sitemap.ts` だけが
 * `["ja"]` に直されていて `middleware` と `i18n/config` は別々に "en" を持って
 * おり、「sitemap から消えた = 到達できない」と誤読する事故が起きている。
 */
describe("公開する locale は enabledLocales 1 箇所で決まる", () => {
  it("英語版は公開されていない (意図せず復活したらここが赤くなる)", () => {
    expect(enabledLocales).toEqual(["ja"]);
    expect(isEnabledLocale("en")).toBe(false);
    expect(isDisabledLocale("en")).toBe(true);
  });

  it("disabledLocales は enabledLocales から自動で決まる", () => {
    expect([...disabledLocales].sort()).toEqual(
      locales.filter((l) => !enabledLocales.includes(l)).sort(),
    );
    // 実装は消していない = 止めた locale も `locales` には残っている
    expect(locales).toContain("en");
    // 英語版を出す判断がついたら enabledLocales に戻すだけで済むこと
    expect(new Set([...enabledLocales, ...disabledLocales])).toEqual(
      new Set(locales),
    );
  });

  it("既定 locale は必ず公開されている (全 locale を止めてサイトを殺せない)", () => {
    expect(enabledLocales.length).toBeGreaterThan(0);
    expect(isEnabledLocale(defaultLocale)).toBe(true);
  });
});

describe("locale のベタ書きが残っていない (単一正本)", () => {
  /** 走査対象。`i18n/config.ts` だけが locale を literal で持ってよい。 */
  const SCAN_DIRS = ["app", "components", "lib", "i18n", "hooks"];
  const SCAN_FILES = ["middleware.ts", "next.config.ts"];
  const SOT = path.join(ROOT, "i18n", "config.ts");

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
        acc.push(full);
    }
    return acc;
  }

  const sourceFiles = [
    ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
    ...SCAN_FILES.map((f) => path.join(ROOT, f)),
  ].filter((f) => f !== SOT);

  it("対応言語の配列を持つのは i18n/config.ts だけ", () => {
    // `["ja", "en"]` / `["ja"]` のような「対応言語の一覧」の literal を探す。
    // 配列の全要素が locale 名のときだけ拾うので、たまたま "ja" を含む別用途の
    // 配列 (例: 通貨や国コードの一覧) は誤検知しない。
    const localeArray = /\[\s*"(?:ja|en)"(?:\s*,\s*"(?:ja|en)")*\s*,?\s*\]/;
    const offenders = sourceFiles.filter((f) =>
      localeArray.test(code(path.relative(ROOT, f))),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("到達性を決めるファイルが locale の URL 接頭辞を名指ししていない", () => {
    // 公開可否を実装している 4 ファイルだけを見る。ここに `"/en"` が literal で
    // 現れたら、`enabledLocales` を戻しても片側だけ止まったままになる。
    //
    // 対象外にしているもの:
    // - `(?:ja|en)` のように**全 locale をまとめて受ける**正規表現 (公開可否では
    //   なく「locale 接頭辞かどうか」の判定なので正当)
    // - `locale === "en"` 等、locale 別に**中身を出し分ける**コード
    //   (app/[locale]/layout.tsx の metadata 等)。実装は消さない方針なので残る
    const GATE_FILES = [
      "middleware.ts",
      "next.config.ts",
      "app/sitemap.ts",
      "components/layout/language-switcher.tsx",
    ];
    const offenders = GATE_FILES.filter((f) => /"\/en\b/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("sitemap は enabledLocales を参照する", () => {
    const src = read("app/sitemap.ts");
    expect(src).toContain("enabledLocales");
    expect(src).toContain('from "@/i18n/config"');
  });

  it("言語切替 UI は enabledLocales を参照する", () => {
    const src = read("components/layout/language-switcher.tsx");
    expect(src).toContain("enabledLocales");
    expect(src).not.toMatch(/\blocales\.map\b/);
  });
});

describe("next.config.ts の redirects が公開停止 locale を全 path で塞ぐ", () => {
  const src = read("next.config.ts");

  it("リダイレクトは disabledLocales から派生している", () => {
    expect(src).toMatch(/disabledLocales\.flatMap/);
    expect(src).toMatch(/\.\.\.disabledLocaleRedirects/);
  });

  it("接頭辞だけの URL と配下の全 path の両方を対象にしている", () => {
    // `/en` 単体と `/en/:path*` の 2 本が要る。`:path*` が無いと配下が素通りする。
    expect(src).toMatch(/source: `\/\$\{locale\}`/);
    expect(src).toMatch(/source: `\/\$\{locale\}\/:path\*`/);
    expect(src).toMatch(/destination: `\/\$\{defaultLocale\}`/);
    expect(src).toMatch(/destination: `\/\$\{defaultLocale\}\/:path\*`/);
    expect(src).toMatch(/permanent: true/);
  });

  it("公開停止 locale のリダイレクトが他のルールより先に来る", () => {
    const spread = src.indexOf("...disabledLocaleRedirects");
    const localeScoped = src.indexOf('"/:locale(ja|en)/contact/business"');
    expect(spread).toBeGreaterThan(-1);
    expect(localeScoped).toBeGreaterThan(-1);
    // 後段に `/:locale(ja|en)` を取るルールがあるので、先に寄せないと 2 段
    // リダイレクト (`/en/contact/business` → `/en/contact` → `/ja/contact`) になる
    expect(spread).toBeLessThan(localeScoped);
  });
});

describe("middleware も公開停止 locale を弾く (多層防御)", () => {
  async function run(pathname: string) {
    // middleware はモジュール読み込み時に SITE_PASSWORD を捕まえるので、
    // import より先に空にしてサイトパスワードのゲートを外す。
    process.env.SITE_PASSWORD = "";
    const { NextRequest } = await import("next/server");
    const { default: middleware } = await import("../middleware");
    return middleware(
      new NextRequest(new URL(`https://elxea.com${pathname}`)),
    );
  }

  it("/en/* は /ja/* へ 301", async () => {
    const res = await run("/en/about");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://elxea.com/ja/about");
  });

  it("クエリ文字列を落とさない", async () => {
    const res = await run("/en/products?sort=new");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://elxea.com/ja/products?sort=new",
    );
  });

  it("/ja/* の挙動は変えない (ここが赤いと全ページが死ぬ)", async () => {
    const res = await run("/ja/about");
    expect(res.status).not.toBe(301);
    expect(res.headers.get("location")).not.toBe("https://elxea.com/ja/ja/about");
  });

  it("`en` で始まるだけの path を巻き込まない", async () => {
    // 旧実装の `pathname.startsWith("/en")` は `/entry` を `/jatry` へ飛ばした
    const res = await run("/entry");
    expect(res.headers.get("location") ?? "").not.toContain("/jatry");
    expect(res.status).not.toBe(301);
  });
});
