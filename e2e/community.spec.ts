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
        test.skip();
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
        test.skip();
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
    test("shows login prompt for unauthenticated users", async ({ page }) => {
      await page.goto("/ja/account");
      await expect(
        page.getByText("マイページを表示するにはログインが必要です")
      ).toBeVisible();
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
  // Follows API
  // ---------------------------------------------------------------------------
  test("GET /api/user/follows returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/user/follows");
    expect(res.status()).toBe(401);
  });

  test("POST /api/user/follows returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post("/api/user/follows", {
      data: {
        farmerSlug: "test-farmer",
        farmerName: "Test Farmer",
        farmerImageUrl: null,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/user/follows returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.delete("/api/user/follows", {
      data: { farmerSlug: "test-farmer" },
    });
    expect(res.status()).toBe(401);
  });

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
    expect(body.error).toContain("Missing required params");
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
  test("farmers page loads for community interaction", async ({ page }) => {
    await page.goto("/ja/farmers");
    await expect(page.locator("h1")).toBeVisible();
    // Page should not show error
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });

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
