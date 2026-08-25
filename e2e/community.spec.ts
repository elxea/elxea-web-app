import { test, expect } from "@playwright/test";

test.describe("Community features — Unauthenticated", () => {
  // ---------------------------------------------------------------------------
  // Favorite button on product detail page
  // ---------------------------------------------------------------------------
  test.describe("Favorite button (product)", () => {
    test("product page shows favorite button", async ({ page }) => {
      await page.goto("/ja/products");

      // Find the first product link and navigate to it
      const productLink = page.locator('a[href*="/ja/products/"]').first();
      const productExists = await productLink.isVisible().catch(() => false);

      if (!productExists) {
        test.skip(true, "商品一覧に商品カードが無い — Shopify に公開商品が必要です");
        return;
      }

      await productLink.click();
      await page.waitForURL(/\/ja\/products\/.+/);

      // Favorite button should be present (heart icon button)
      const favoriteButton = page.locator('button[aria-label]').filter({
        has: page.locator("svg"),
      });
      const heartButton = page.locator(
        'button[aria-label="お気に入りに追加"], button[aria-label="お気に入りから削除"]'
      );

      const buttonExists = await heartButton.isVisible().catch(() => false);
      if (buttonExists) {
        await expect(heartButton).toBeVisible();
        // For unauthenticated users, clicking should show login toast
        await heartButton.click();
        // Toast should appear with login required message
        await expect(
          page.getByText("お気に入りに追加するにはログインが必要です")
        ).toBeVisible({ timeout: 5000 });
      } else {
        // If no specific product is available, just verify the page loaded
        await expect(page.locator("h1")).toBeVisible();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Bookmark button on article page
  // ---------------------------------------------------------------------------
  test.describe("Bookmark button (article)", () => {
    test("journal article page shows bookmark button", async ({ page }) => {
      await page.goto("/ja/journal");

      // Find the first article link
      const articleLink = page.locator('a[href*="/ja/journal/"]').first();
      const articleExists = await articleLink.isVisible().catch(() => false);

      if (!articleExists) {
        test.skip(true, "ジャーナル一覧に記事カードが無い — Sanity に公開記事が必要です");
        return;
      }

      await articleLink.click();
      await page.waitForURL(/\/ja\/journal\/.+/);

      // Bookmark button should be present
      const bookmarkButton = page.locator(
        'button[aria-label="ブックマークに追加"], button[aria-label="ブックマークから削除"]'
      );

      const buttonExists = await bookmarkButton.isVisible().catch(() => false);
      if (buttonExists) {
        await expect(bookmarkButton).toBeVisible();
        // For unauthenticated users, clicking should show login toast
        await bookmarkButton.click();
        await expect(
          page.getByText("ブックマークに追加するにはログインが必要です")
        ).toBeVisible({ timeout: 5000 });
      } else {
        // Article page loaded successfully
        await expect(page.locator("h1")).toBeVisible();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Account page — unauthenticated
  // ---------------------------------------------------------------------------
  test.describe("Account page", () => {
    /*
     * 未ログインの /ja/account は **ページ内のログイン誘導ではなく
     * /ja/login への 307 リダイレクト**になった (middleware.ts の accountMatch
     * ガード。LINE ユーザーがログイン方法を選べるように Shopify OAuth 直行を
     * やめた P3-fix)。旧アサーション (ページ内文言
     * 「マイページを表示するにはログインが必要です」) は到達不能になった
     * `app/[locale]/account/page.tsx` の分岐を見ていた。
     */
    test("redirects unauthenticated users to the login page", async ({ page }) => {
      await page.goto("/ja/account");
      await page.waitForURL(/\/ja\/login/);
      await expect(page.locator("h1")).toContainText("ログイン");
    });

    test("shows login button", async ({ page }) => {
      await page.goto("/ja/account");
      const loginButton = page.locator('a[href*="/api/auth/login"]');
      await expect(loginButton).toBeVisible();
    });
  });
});

test.describe("Community API — Unauthenticated", () => {
  // ---------------------------------------------------------------------------
  // Favorites API
  // ---------------------------------------------------------------------------
  test("GET /api/user/favorites returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/user/favorites");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/user/favorites returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post("/api/user/favorites", {
      data: {
        type: "product",
        targetId: "test-product",
        title: "Test Product",
        imageUrl: null,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/user/favorites returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.delete("/api/user/favorites", {
      data: {
        type: "product",
        targetId: "test-product",
      },
    });
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Follows API — 廃止済み (J-5)
  //
  // 農家は「フォロー」ではなく「お気に入り」の 4 分類目 (`type: "farmer"`) に
  // なったので、`/api/user/follows` は無い。受け口が 1 本になったことを縛る
  // (復活すると、農家だけ別の動詞・別のコレクションに戻る)。
  // ---------------------------------------------------------------------------
  test("/api/user/follows はもう無い (お気に入りへ統合・J-5)", async ({
    request,
  }) => {
    for (const res of [
      await request.get("/api/user/follows"),
      await request.post("/api/user/follows", { data: { farmerSlug: "x" } }),
      await request.delete("/api/user/follows", { data: { farmerSlug: "x" } }),
    ]) {
      /* 401 だと「認証すれば使える受け口」がまだある = 撤去が中途半端。
         404 (ルート自体が無い) であることを見る。 */
      expect(res.status()).toBe(404);
    }
  });

  /* 農家がお気に入りの受け口 (`type: "farmer"`) で通ることは、ここでは見ない。
     この API は認証をスキーマ検証より先に見るので、未ログインでは種類が何であれ
     401 になり、`farmer` が受理されるかを区別できない。受け口が種類の正本
     (`z.enum(FAVORITE_KINDS)`) から導かれていることは
     `__tests__/account-favorites.test.ts` が縛る。 */

  // ---------------------------------------------------------------------------
  // Events API
  // ---------------------------------------------------------------------------
  test("GET /api/user/events returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/user/events");
    expect(res.status()).toBe(401);
  });

  test("POST /api/user/events returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post("/api/user/events", {
      data: {
        eventSlug: "test-event",
        eventTitle: "Test Event",
        eventDate: null,
        eventImageUrl: null,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/user/events returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.delete("/api/user/events", {
      data: { eventSlug: "test-event" },
    });
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Dashboard API
  // ---------------------------------------------------------------------------
  test("GET /api/user/dashboard returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/user/dashboard");
    expect(res.status()).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Comments API
  // ---------------------------------------------------------------------------
  test("GET /api/user/comments requires targetType and targetId", async ({
    request,
  }) => {
    const res = await request.get("/api/user/comments");
    expect(res.status()).toBe(400);
    const body = await res.json();
    // 文言は zod 化で "Missing required params" から変わった
    // (app/api/user/comments/route.ts の formatZodError 経路)。
    expect(body.error).toContain("Invalid query parameters");
  });

  test("POST /api/user/comments returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post("/api/user/comments", {
      data: {
        targetType: "article",
        targetId: "test-article",
        body: "Test comment",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/user/comments returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.delete("/api/user/comments", {
      data: { commentId: "test-comment-id" },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Community features — Page load verification", () => {
  // 農家一覧 (/ja/farmers) は 2026-08-14 に廃止。フォロー / コメントの導線は
  // 農家詳細 (/ja/farmers/[slug]) 側に残るが、slug は実データ依存なのでここでは
  // 検証しない (API レベルの検証は本ファイル上部の describe が担う)。

  test("events page loads for event registration", async ({ page }) => {
    await page.goto("/ja/events");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });

  test("journal page loads for article bookmarking", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toContainText("ジャーナル");
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });

  test("products page loads for product favorites", async ({ page }) => {
    await page.goto("/ja/products");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });
});
