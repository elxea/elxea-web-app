/**
 * 「押したら、その場で見た目が変わる」を**表示の切替にも**要求する
 * (網羅表 2026-08-27 / G5・G6・G9・G10)。
 *
 * ## なぜこの検査が要るのか
 *
 * 書き込みには `lib/interaction` という 1 本の通り道があり、eslint ルール
 * (`mutation-through-shared-primitive`) がそこを通ることを機械で要求している。
 * ところが**表示の切替には通り道も検査も無かった**。網羅表の実測では、
 * ユーザーが押せる操作 104 件のうち 78 件が表示切替で、そのすべてが
 * 「一度も数えられたことがない」状態だった。
 *
 * その結果、同じ商品ページの中でさえ手当てが割れていた —
 * バリアント選択は `router.replace` をやめて即時描画に移してあるのに
 * (`components/product/variant-selection-context.tsx` の冒頭注記)、
 * すぐ隣のカテゴリ絞り込みは `router.push` を呼ぶだけで、選択の塗り替えすら
 * サーバの往復を待っていた。
 *
 * ## 何を縛るか
 *
 * `app/` `components/` の client component で `router.push` / `router.replace`
 * を呼ぶファイルは、**次のどちらか**でなければならない:
 *
 *   (a) `hooks/use-optimistic-navigation` を通している
 *       (= 押した値を先に描き、着地でサーバの値へ合流する)
 *   (b) 下の例外表に**理由付きで**載っている
 *
 * 例外表は**両方向**に縛る (`ratchets.json` の作法と同じ) —
 * 増やせないだけでなく、実体が消えた行が残っていても落ちる。
 *
 * ## この検査自体が壊れていないことの確認
 *
 * 最後の describe が、**壊した入力を渡して確実に落ちること**を確かめる
 * (`__tests__/ratchet.test.ts` と同じ作法)。判定が常に真になる検査は、
 * 検査していないのと同じなので。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
/**
 * 走査範囲。**拡張子と配置で絞らない**。
 *
 * 網羅表 S1 が挙げた穴と同じものを、この検査自身が作らないため。eslint の
 * `files` glob は `components/**\/*.tsx` と `app/**\/*.tsx` しか見ておらず、
 * その結果 `.tsx` を `.ts` に変えるだけで監査から消える状態になっていた。
 * ここは `hooks/` も、`.ts` も見る。
 */
const SCAN_DIRS = ["app", "components", "hooks"];
const SCAN_EXTENSIONS = [".tsx", ".ts"];
const HOOK_IMPORT = "@/hooks/use-optimistic-navigation";

/**
 * 例外 — **表示の切替ではない** `router.push` / `router.replace`。
 *
 * ここに足すのは「押した結果として別のページへ移る」ものだけ。移った先が
 * まるごと別の画面なら、先に描いておける『選択』が存在しない。
 * 「まだ直していない」を理由に足さないこと。
 */
const ALLOWLIST: Record<string, string> = {
  "app/password/page.tsx":
    "認証が着地したあとの移動。押した時点では通るかどうかが決まっていないので、先に描ける選択が無い",
  "components/product/add-to-cart-button.tsx":
    "トーストの「カートを見る」= 別ページへの移動。同じ画面の見た目を切り替える操作ではない",
};

/* -------------------------------------------------------------------------- */
/* 走査                                                                        */
/* -------------------------------------------------------------------------- */

function listSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      listSources(full, acc);
      continue;
    }
    if (!SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
    if (/\.(stories|test)\.tsx?$/.test(entry)) continue;
    if (entry.endsWith(".d.ts")) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * コメントを落とす。**注記の中の `router.replace`** を実装と数えないため
 * (`variant-selection-context.tsx` はまさにそれで、実装はもう即時描画に
 * 移してあるのに冒頭の説明文に語が残っている)。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function navigatesOnGesture(source: string): boolean {
  return /\brouter\.(push|replace)\s*\(/.test(stripComments(source));
}

/**
 * ハンドラの中から**直に**遷移しているか (= 通り道を通っていない形)。
 *
 * `onClick={() => router.push(...)}` は当たり、
 * `onClick={() => nav.navigate(v, () => router.push(...))}` は当たらない
 * (途中に `.navigate(` があるため)。
 */
export function hasDirectHandlerNavigation(source: string): boolean {
  const stripped = stripComments(source);
  return /on[A-Z]\w*=\{(?:(?!\.navigate\()[^}])*?\brouter\.(push|replace)\s*\(/.test(stripped);
}

const FILES = SCAN_DIRS.flatMap((dir) => listSources(join(ROOT, dir))).map((f) =>
  relative(ROOT, f),
);

const NAVIGATING = FILES.filter((f) => navigatesOnGesture(readFileSync(join(ROOT, f), "utf8")));

/* -------------------------------------------------------------------------- */

describe("表示の切替は共通の通り道を通る", () => {
  it("走査対象が空ではない (glob が外れていたら検査が空振りする)", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(NAVIGATING.length).toBeGreaterThan(0);
  });

  it.each(
    NAVIGATING.filter((f) => !(f in ALLOWLIST)).map((f) => [f] as const),
  )("%s は useOptimisticNavigation を通している", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");

    expect(
      source.includes(HOOK_IMPORT),
      `${file} が遷移するのに ${HOOK_IMPORT} を通していない。` +
        `押した瞬間に選択が変わらないので、サーバの往復のあいだ「押した覚えのない画面」が見える。` +
        `別ページへ移るだけの操作なら ALLOWLIST に理由付きで載せること。`,
    ).toBe(true);

    expect(
      hasDirectHandlerNavigation(source),
      `${file} のハンドラが router を直に呼んでいる。遷移は navigate() の中で起こすこと ` +
        `(外で起こすと楽観値が次の描画で捨てられる)。`,
    ).toBe(false);
  });
});

describe("例外表は両方向に縛る", () => {
  it("載っているファイルは実在する", () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(() => statSync(join(ROOT, file)), `${file} が無い`).not.toThrow();
    }
  });

  it("載っているファイルは本当に遷移している (直ったら行を消す)", () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(
        NAVIGATING.includes(file),
        `${file} はもう router で遷移していない。ALLOWLIST の行を消すこと`,
      ).toBe(true);
    }
  });

  it("理由が書いてある", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} の理由が短すぎる`).toBeGreaterThan(10);
    }
  });
});

describe("この検査は壊れた入力で落ちる", () => {
  it("直に遷移するハンドラを見つける", () => {
    const bad = `"use client";
      export function Bad() {
        return <button onClick={() => router.push("/x")}>x</button>;
      }`;
    expect(navigatesOnGesture(bad)).toBe(true);
    expect(hasDirectHandlerNavigation(bad)).toBe(true);
  });

  it("通り道を通した形は見逃す (誤検知しない)", () => {
    const good = `"use client";
      export function Good() {
        return <button onClick={() => nav.navigate("x", () => router.push("/x"))}>x</button>;
      }`;
    expect(navigatesOnGesture(good)).toBe(true);
    expect(hasDirectHandlerNavigation(good)).toBe(false);
  });

  it("注記の中の router.replace は実装と数えない", () => {
    const commentOnly = `/**
      * 以前は router.replace() を呼んでいた。
      */
      export function Fine() { return null; }`;
    expect(navigatesOnGesture(commentOnly)).toBe(false);
  });
});
