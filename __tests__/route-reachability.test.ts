/**
 * 「実装したのに、サイト内のどこからも辿り着けないページ」を止めるゲート。
 *
 * ## なぜ 1 ページ限定にしないか
 * 2026-08-18、`/signs` (みんなの気配) が完成して本番に載っているのに
 * サイト全域からのリンクが 0 件で、Setaka が「つくった data viz が
 * みんなのこえとして見れるページの遷移先がない」と気づくまで誰も検知できなかった。
 * 同じことは次に作る画面でも起きる。よってこのテストは
 * **`app/[locale]/**\/page.tsx` に存在する静的ルート全件**を母集団に取り、
 * 「どこからもリンクされていない」状態そのものを検出する。
 * `/signs` だけを見るテストにすると、同型の 2 件目を拾えない。
 *
 * ## 何を「到達できる」と数えるか
 * 同一リポジトリの `app/ components/ lib/` 配下のソースから、
 * **`href` としてそのパスを指している記述** (`href="/x"` / `href: "/x"` /
 * `href={"/x"}` / `` href={`/x`} ``) が、そのページ自身のファイル以外に
 * 1 件以上あること。
 *
 * 意図的にゆるくしている点と、その理由:
 * - 実際にレンダリングされるかまでは見ない (それは e2e の仕事)。ここで見るのは
 *   「導線を書き忘れた / 消した」という **ソース上の欠落**。安く・速く・
 *   ビルド不要で回るゲートにするための線引き。
 * - `app/sitemap.ts` は数えない。サイトマップは検索エンジン向けの通知であって
 *   サイト内の導線ではない。sitemap にだけ載っている状態は「人が辿り着ける」に
 *   当たらない。
 *
 * ## 例外の置き方
 * 外部から直接入る面 (LINE の LIFF、認証コールバックの着地) は
 * サイト内リンクが無いのが正しい。`UNLINKED_BY_DESIGN` に **理由付きで**
 * 挙げる。理由を書けないものは例外ではなく、直すべき欠落。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_ROOT = path.join(ROOT, "app", "[locale]");
/** リンク元として数えるソースツリー (sitemap.ts はここに含めない = app 直下は除外)。 */
const LINK_SOURCE_DIRS = ["app/[locale]", "components", "lib"];

/**
 * サイト内リンクが無いのが正しいルートと、その理由。
 * 追加するときは「なぜサイト内から入らないのか」を必ず書くこと。
 */
const UNLINKED_BY_DESIGN: Record<string, string> = {
  "/liff/link":
    "LINE の LIFF から起動される連携画面。入口は LINE アプリ側であり、サイト内に導線は持たない。",
  "/login/complete":
    "ログイン完了後の着地点。認証フローのリダイレクト先であって、人がナビから選ぶ面ではない。",
  "/tasting-note":
    "TODO(2026-08-18): 一覧側の導線が未配線。/tasting-note/feedback は chat の CTA から入れるが、" +
    "この一覧そのものはどこからも入れない。/signs と同型の欠落として検出済み。IA の置き場は Setaka 判断待ち。",
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/** `app/[locale]/(reading)/tea-menu/page.tsx` -> `/tea-menu` (ルートグループは URL に出ない)。 */
function routeForPageFile(file: string): string | null {
  const rel = path.relative(PAGES_ROOT, file).replace(/\/page\.tsx$/, "");
  const segments = rel
    .split(path.sep)
    .filter((s) => s !== "" && s !== "page.tsx")
    .filter((s) => !/^\(.*\)$/.test(s));
  // 動的セグメントは「静的な URL」を持たないので母集団外 (親の一覧が導線を担う)。
  if (segments.some((s) => s.includes("["))) return null;
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

const staticRoutes = walk(PAGES_ROOT)
  .filter((f) => f.endsWith(`${path.sep}page.tsx`))
  .map((file) => ({ file, route: routeForPageFile(file) }))
  .filter((r): r is { file: string; route: string } => r.route !== null);

const linkSources = LINK_SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).filter(
  (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
);

/** href として書かれたサイト内パス -> それを書いているファイル。 */
const hrefIndex = new Map<string, Set<string>>();
for (const file of linkSources) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/href\s*[=:]\s*\{?\s*["'`](\/[^"'`${}\s]*)["'`]/g)) {
    const href = match[1].replace(/\/$/, "") || "/";
    if (!hrefIndex.has(href)) hrefIndex.set(href, new Set());
    hrefIndex.get(href)!.add(file);
  }
}

function linkersFor(route: string, ownFile: string): string[] {
  return [...(hrefIndex.get(route) ?? [])].filter((f) => f !== ownFile);
}

describe("route reachability", () => {
  it("母集団が空になっていない (走査が壊れたのに緑になる事故を防ぐ)", () => {
    expect(staticRoutes.length).toBeGreaterThan(20);
    expect(staticRoutes.map((r) => r.route)).toContain("/signs");
    expect(linkSources.length).toBeGreaterThan(100);
  });

  it.each(staticRoutes.filter(({ route }) => !(route in UNLINKED_BY_DESIGN)))(
    "$route はサイト内のどこかからリンクされている",
    ({ route, file }) => {
      const linkers = linkersFor(route, file);
      expect(
        linkers.length,
        `${route} は実装されているのに、app/[locale] / components / lib のどこからも ` +
          `href として参照されていない。ユーザーはこのページに辿り着けない。` +
          `導線を足すか、外部から入る面なら理由を添えて UNLINKED_BY_DESIGN に登録すること。`,
      ).toBeGreaterThan(0);
    },
  );

  it("例外リストが古びていない (導線が付いたルートは例外から外す)", () => {
    for (const route of Object.keys(UNLINKED_BY_DESIGN)) {
      const entry = staticRoutes.find((r) => r.route === route);
      expect(entry, `UNLINKED_BY_DESIGN の ${route} は既に存在しないルート。行を削除すること。`).toBeDefined();
      expect(UNLINKED_BY_DESIGN[route].length, `${route} の除外理由が空`).toBeGreaterThan(10);
    }
  });

  /**
   * /signs だけの追加ピン。上の汎用テストは「どこか 1 箇所から参照されていれば緑」なので、
   * 詳細ページの中の相互リンクだけでも通ってしまう。このページは Setaka が
   * 「遷移先がない」と気づいた当事者なので、**全ページに出る共通ナビ (ヘッダー / フッター)**
   * から入れることまでを固定する。
   */
  it("/signs は全ページ共通のナビ (ヘッダー or フッター) からリンクされている", () => {
    const chrome = linkersFor("/signs", "").filter((f) =>
      /components\/layout\/(header|footer)\.tsx$/.test(f),
    );
    expect(
      chrome.length,
      "/signs (みんなの気配) への導線が共通ナビから消えている。" +
        "2026-08-18 に『つくったのに遷移先がない』が起きた再発防止のピン。",
    ).toBeGreaterThan(0);
  });
});
