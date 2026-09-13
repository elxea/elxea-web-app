/**
 * ページ単位の公開制御 (`config/page-visibility.json` → middleware の 404) を固定する。
 *
 * 押さえるのは 4 つで、どれも壊れ方が違う:
 *
 *   1. 非公開と宣言したページが **404 になる** — 仕組みそのもの。
 *   2. 公開と宣言したページは **素通る** — 仕組みが公開範囲を勝手に狭めない。
 *   3. 既存の 3 つのゲート (サイト全体の閲覧ゲート / `disabledLocales` /
 *      `/dev/*` の本番 404) の挙動を**変えていない**。この判定は既存ゲートの
 *      あいだに割り込むので、順番を間違えると「LINE 連携が死ぬ」「`/en` が
 *      転送されない」といった形で静かに壊れる。
 *   4. 宣言そのものが **現状と等価** — Step 1 は仕組みを入れるだけで、
 *      どのページを出すかは変えない、という約束の機械的な裏取り。
 *
 * `middleware.ts` は `SITE_PASSWORD` / `VERCEL_ENV` と公開宣言を**モジュール
 * 読み込み時**に読む。したがって差し替えるたびに `vi.resetModules()` してから
 * 動的 import する。import 文で済ませると全ケースが最初の状態を共有する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import realVisibility from "@/config/page-visibility.json";
import {
  diffRoutes,
  listRouteFiles,
  toUrlPath,
  validateManifest,
  type PageVisibilityManifest,
} from "@/scripts/check-page-visibility";

/**
 * i18n 層だけをスタブする。理由は middleware-site-password.test.ts と同じで、
 * `next-intl/middleware` が node 環境下で `next/server` を解決できないため。
 *
 * 検証対象は潰れない。公開制御の判定は `intlMiddleware` に到達する**前**に
 * return するので、404 は実物の判定が作る。「通した」ケースはその 404 が
 * **無いこと**として観測するので、スタブ側が合格を捏造することはできない。
 */
vi.mock("next-intl/middleware", () => ({
  default: () => (_request: NextRequest) => NextResponse.next(),
}));

type Fixture = Pick<PageVisibilityManifest, "routes">;

/** 宣言を差し替えたうえで middleware を読み直す。 */
async function loadMiddleware(
  fixture?: Fixture,
  env: { sitePassword?: string; vercelEnv?: string; nodeEnv?: string } = {},
) {
  if (env.sitePassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = env.sitePassword;

  if (env.vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env.vercelEnv;

  vi.resetModules();
  if (fixture) {
    vi.doMock("@/config/page-visibility.json", () => ({
      default: { version: 1, routes: fixture.routes, outOfScope: [] },
    }));
  } else {
    vi.doUnmock("@/config/page-visibility.json");
  }

  const mod = await import("@/middleware");
  return mod.default;
}

function request(url: string) {
  return new NextRequest(new URL(url));
}

const ORIGIN = "https://elxea.com";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.doUnmock("@/config/page-visibility.json");
  vi.resetModules();
  delete process.env.SITE_PASSWORD;
  delete process.env.VERCEL_ENV;
});

describe("非公開と宣言したページ", () => {
  it("404 を返す (locale 接頭辞あり)", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/journal", visible: false }],
    });
    const res = await middleware(request(`${ORIGIN}/ja/journal`));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("404 を返す (locale 接頭辞なし — intl の転送より前に判定する)", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/journal", visible: false }],
    });
    const res = await middleware(request(`${ORIGIN}/journal`));
    expect(res.status).toBe(404);
  });

  it("動的ルートの型を 1 行で止められる", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/products/[handle]", visible: false }],
    });
    const res = await middleware(request(`${ORIGIN}/ja/products/sencha-01`));
    expect(res.status).toBe(404);
  });

  it("トップ (\"/\") も止められる", async () => {
    const middleware = await loadMiddleware({ routes: [{ route: "/", visible: false }] });
    expect((await middleware(request(`${ORIGIN}/ja`))).status).toBe(404);
    expect((await middleware(request(`${ORIGIN}/`))).status).toBe(404);
  });
});

describe("公開と宣言したページ", () => {
  it("404 にならない", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/journal", visible: true }],
    });
    const res = await middleware(request(`${ORIGIN}/ja/journal`));
    expect(res.status).not.toBe(404);
  });

  it("静的な宣言が動的な宣言より優先される (/journal/category は /journal/[slug] に食われない)", async () => {
    const middleware = await loadMiddleware({
      routes: [
        { route: "/journal/[slug]", visible: false },
        { route: "/journal/category", visible: true },
      ],
    });
    expect((await middleware(request(`${ORIGIN}/ja/journal/category`))).status).not.toBe(404);
    expect((await middleware(request(`${ORIGIN}/ja/journal/anything-else`))).status).toBe(404);
  });

  it("宣言に無い path は middleware が 404 を作らず Next に渡す (ブランドの 404 を残すため)", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/journal", visible: true }],
    });
    const res = await middleware(request(`${ORIGIN}/ja/totally-unknown`));
    expect(res.status).not.toBe(404);
  });
});

describe("既存ゲートとの干渉", () => {
  it("/en/* の /ja/* への転送が先に効く (公開制御が横取りしない)", async () => {
    const middleware = await loadMiddleware({
      routes: [{ route: "/journal", visible: false }],
    });
    const res = await middleware(request(`${ORIGIN}/en/journal`));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/ja/journal`);
  });

  it("/dev/* は本番で 404 のまま (公開制御の対象外)", async () => {
    const nodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const middleware = await loadMiddleware(
        { routes: [{ route: "/journal", visible: true }] },
        { vercelEnv: "production" },
      );
      expect((await middleware(request(`${ORIGIN}/dev/profile`))).status).toBe(404);
    } finally {
      vi.stubEnv("NODE_ENV", nodeEnv ?? "test");
    }
  });

  it("サイト全体の閲覧ゲートが先に効く (公開ページでも /password へ飛ぶ)", async () => {
    const middleware = await loadMiddleware(
      { routes: [{ route: "/journal", visible: true }] },
      { sitePassword: "test-site-password" },
    );
    const res = await middleware(request(`${ORIGIN}/ja/journal`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/password`);
  });

  it("閲覧ゲート免除の /legal/* は免除のまま (公開制御を足しても変わらない)", async () => {
    const middleware = await loadMiddleware(
      { routes: [{ route: "/legal/terms", visible: true }] },
      { sitePassword: "test-site-password" },
    );
    const res = await middleware(request(`${ORIGIN}/ja/legal/terms`));
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(404);
  });
});

describe("宣言そのもの (config/page-visibility.json)", () => {
  it("形が正しい", () => {
    expect(validateManifest(realVisibility)).toEqual([]);
  });

  it("app/ の実ルートと一致している (ビルドゲートと同じ判定)", () => {
    const manifest = realVisibility as unknown as PageVisibilityManifest;
    expect(diffRoutes(manifest, listRouteFiles())).toEqual([]);
  });

  it("Step 1 の初期値は現状と等価 — 非公開にしたページは 1 つも無い", () => {
    const hidden = realVisibility.routes.filter((r) => !r.visible).map((r) => r.route);
    expect(hidden).toEqual([]);
  });

  it("LINE 連携の入口 (/link, /liff/link) を公開のまま持っている", () => {
    const byRoute = new Map(realVisibility.routes.map((r) => [r.route, r.visible] as const));
    expect(byRoute.get("/link")).toBe(true);
    expect(byRoute.get("/liff/link")).toBe(true);
  });
});

describe("ビルドゲート (scripts/check-page-visibility.ts)", () => {
  it("app/ のファイルパスを URL パスに直す (ルートグループは落ちる)", () => {
    expect(toUrlPath("[locale]/(reading)/journal/[slug]/page.tsx")).toBe("/journal/[slug]");
    expect(toUrlPath("[locale]/page.tsx")).toBe("/");
    expect(toUrlPath("[locale]/link/route.ts")).toBe("/link");
    // [locale] の外は公開制御の対象外
    expect(toUrlPath("dev/me/page.tsx")).toBeNull();
    expect(toUrlPath("[locale]/journal/layout.tsx")).toBeNull();
  });

  it("宣言に無いルートがあったら落とす (これが『勝手に本番へ出ない』の担保)", () => {
    const manifest: PageVisibilityManifest = {
      version: 1,
      routes: [{ route: "/journal", visible: true }],
      outOfScope: [],
    };
    const problems = diffRoutes(manifest, [
      "[locale]/journal/page.tsx",
      "[locale]/secret-launch/page.tsx",
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("/secret-launch");
    expect(problems[0]).toContain("config/page-visibility.json に行を足してください");
    expect(problems[0]).toContain('"visible": false');
  });

  it("[locale] の外に新しい面を生やしたら、outOfScope に理由を書くまで落ちる", () => {
    const manifest: PageVisibilityManifest = { version: 1, routes: [], outOfScope: [] };
    const problems = diffRoutes(manifest, ["internal-tools/page.tsx"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("outOfScope");
  });

  it("消したページの宣言が残っていたら落とす", () => {
    const manifest: PageVisibilityManifest = {
      version: 1,
      routes: [{ route: "/retired", visible: true }],
      outOfScope: [],
    };
    const problems = diffRoutes(manifest, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("app/ に実体がありません");
  });

  it("locale 接頭辞つきの宣言を拒む (1 行が全 locale を受け持つ)", () => {
    const errors = validateManifest({
      version: 1,
      routes: [{ route: "/ja/journal", visible: true }],
      outOfScope: [],
    });
    expect(errors.some((e) => e.includes("locale 接頭辞"))).toBe(true);
  });
});
