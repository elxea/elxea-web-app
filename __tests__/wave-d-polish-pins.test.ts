/**
 * Wave D (磨き込み) で直した箇所のうち、**振る舞いが画面側にしか無いもの**を
 * 実装の形で固定する。
 *
 * ## なぜソースを読む形のテストなのか
 *
 * ここに並ぶのは「ページの `<title>` が出るか」「知らせを出す前に着地を待って
 * いないか」といった、Server Component / 画面遷移に張り付いた性質で、単体の
 * Node 環境では実行できない (この repo の `unit` project は jsdom を持たない —
 * `vitest.config.ts`)。ブラウザが要るものは story 側の担当だが、**story を
 * 持たない Server Component** はそこにも載らない。
 *
 * そこで、既に `favorite-toggle-button.test.ts` が採っている手 (実ファイルを
 * 読んで契約を確かめる) を使う。目的は「元に戻したら落ちる」ことであって、
 * 描画の再現ではない。実際に効くかどうかは本番実測で確かめてある
 * (監査 #15/#19/#20/#21 / 2026-08-26)。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEM_ATTRIBUTION, DEM_ATTRIBUTION_URL } from "@/lib/viz/dem";

function source(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), "utf8");
}

/**
 * コメントを落とした本文。
 *
 * このファイルの但し書きは「以前はこう書いていた」を引用するので、素のまま
 * 探すと**説明文そのもの**に当たってしまう (実装が直っていても落ちる)。
 */
function code(...segments: string[]): string {
  return source(...segments)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ja = JSON.parse(source("messages", "ja.json")) as Record<
  string,
  Record<string, unknown>
>;
const en = JSON.parse(source("messages", "en.json")) as Record<
  string,
  Record<string, unknown>
>;

/* -------------------------------------------------------------------------- */
/* #15 カート削除 — 押した瞬間に知らせ、外れたときだけ言い直す                   */
/* -------------------------------------------------------------------------- */

describe("#15 カートの削除は、着地を待ってから知らせない", () => {
  const cart = code("components", "cart", "cart-content.tsx");

  it("知らせを出す前に書き込みの着地を待たない", () => {
    /* 元の実装は `await removeFromCart(item.id);` の**次の行**で知らせていた。
       本番実測 4.3 秒はその待ち時間そのもの。 */
    expect(cart).not.toMatch(/await\s+removeFromCart\(/);
    expect(cart).toMatch(/const\s+pending\s*=\s*removeFromCart\(/);
  });

  it("失敗したときに「削除しました」で終わらせない", () => {
    expect(cart).toMatch(/removeFromCartFailed/);
    expect(ja.common.removeFromCartFailed).toBeTruthy();
    expect(en.common.removeFromCartFailed).toBeTruthy();
    /* 成功と失敗が同じ文言だと、言い直したことにならない。 */
    expect(ja.common.removeFromCartFailed).not.toBe(ja.common.removedFromCart);
  });

  it("処理中であることを見た目以外にも伝える", () => {
    expect(cart).toMatch(/aria-busy=\{isPending\}/);
  });
});

/* -------------------------------------------------------------------------- */
/* #19 イベント一覧 — ページが名乗る / 空でも出口が 2 つある                     */
/* -------------------------------------------------------------------------- */

describe("#19 イベント一覧は自分の名前を名乗る", () => {
  const events = code("app", "[locale]", "events", "page.tsx");

  it("generateMetadata を持つ (`<title>` が素の elxea のままにならない)", () => {
    expect(events).toMatch(/export async function generateMetadata\(\)/);
    expect(events).toMatch(/title:\s*t\("events"\)/);
  });

  it("題を二重管理しない (既存の common.events / event.lead を使う)", () => {
    expect(ja.common.events).toBeTruthy();
    expect((ja.event as Record<string, unknown>).lead).toBeTruthy();
  });

  it("空のときの出口が 2 つある", () => {
    const empty = ja.event as { empty: Record<string, string> };
    expect(empty.empty.ctaLabel).toBeTruthy();
    expect(empty.empty.secondaryCtaLabel).toBeTruthy();
    expect(empty.empty.secondaryCtaLabel).not.toBe(empty.empty.ctaLabel);
    expect(events).toMatch(/empty\.secondaryCtaLabel/);
  });
});

/* -------------------------------------------------------------------------- */
/* #20 地図の帰属表示 — 本文ではなく出典として読める形                          */
/* -------------------------------------------------------------------------- */

describe("#20 地図のクレジットが本文に紛れない", () => {
  const map = code("components", "viz", "terroir", "terroir-overview-map.tsx");

  it("社内語と代用記号を画面に出さない", () => {
    expect(DEM_ATTRIBUTION).not.toContain("(C)");
    expect(DEM_ATTRIBUTION).not.toContain("DEM ");
    expect(DEM_ATTRIBUTION).toContain("©");
  });

  it("出典へのリンクとして置く", () => {
    expect(DEM_ATTRIBUTION_URL).toMatch(/^https:\/\//);
    expect(map).toMatch(/data-slot="map-attribution"/);
    expect(map).toMatch(/href=\{DEM_ATTRIBUTION_URL\}/);
  });

  it("凡例と同じ体裁 (左寄せ・広い字間) では置かない", () => {
    const block = map.slice(map.indexOf('data-slot="map-attribution"'));
    expect(block).toMatch(/text-right/);
    expect(block.slice(0, 400)).not.toMatch(/roji-viz-caption/);
  });
});

/* -------------------------------------------------------------------------- */
/* #21 検索の初期画面 — 何を打てばいいかの手がかりがある                        */
/* -------------------------------------------------------------------------- */

describe("#21 検索の初期画面が入力欄だけにならない", () => {
  const search = code("app", "[locale]", "search", "page.tsx");

  it("入力前に手がかりを出す", () => {
    expect(search).toMatch(/SearchStarters/);
    expect(search).toMatch(/query \? null : \(/);
  });

  it("手がかりは実データから組む (固定の人気キーワードを焼かない)", () => {
    expect(search).toMatch(/productTypeLabel\(category, locale\)/);
    expect(search).toMatch(/getProducts/);
  });

  it("文言が両ロケールに揃っている", () => {
    for (const messages of [ja, en]) {
      const s = messages.search as Record<string, string>;
      expect(s.startersHeading).toBeTruthy();
      expect(s.startersLead).toBeTruthy();
      expect(s.startersMoreHeading).toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* QA 残件 — 記事の茶葉カードに生の productType を出さない                      */
/* -------------------------------------------------------------------------- */

describe("記事の茶葉カードに英日併記の生値を出さない", () => {
  const article = code(
    "app",
    "[locale]",
    "(reading)",
    "journal",
    "[slug]",
    "page.tsx",
  );

  it("productType は必ず表示ラベルに畳んでから出す", () => {
    /* `productTypeLabel(...)` を通さない裸の `product.productType` が
       1 つでも残っていたら落とす (`Green Tea｜緑茶` がそのまま出る)。 */
    const bare = [...article.matchAll(/product\.productType/g)].filter((match) => {
      const before = article.slice(Math.max(0, match.index - 40), match.index);
      return !before.includes("productTypeLabel(");
    });
    expect(bare).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* QA 残件 — lint がローカルの vercel 出力を読みにいかない                      */
/* -------------------------------------------------------------------------- */

describe("lint が生成物を読みにいかない", () => {
  it("ESLint の ignores に .vercel がある", () => {
    const config = source("eslint.config.mjs");
    const ignores = config.slice(config.indexOf("ignores: ["), config.indexOf("]", config.indexOf("ignores: [")));
    expect(ignores).toContain(".vercel/**");
    /* 対で維持する約束 (`.next/**` と同じ理由 = 生成物)。 */
    expect(ignores).toContain(".next/**");
    expect(source(".gitignore")).toMatch(/^\.vercel$/m);
  });
});

/* -------------------------------------------------------------------------- */
/* QA 残件 — 使われていない宣言を残さない                                       */
/* -------------------------------------------------------------------------- */

describe("使われていない宣言を残さない", () => {
  it("定期便 LP に死んだ変数と未使用 import が無い", () => {
    const page = code("app", "[locale]", "subscription", "page.tsx");
    expect(page).not.toMatch(/const selectedVariant/);
    expect(page).not.toMatch(/import \{ Suspense \} from "react"/);
  });

  it("商品詳細に未使用の Suspense import が無い", () => {
    const page = code("app", "[locale]", "products", "[handle]", "page.tsx");
    expect(page).not.toMatch(/import \{ Suspense \} from "react"/);
    expect(page).not.toMatch(/<Suspense/);
  });
});
