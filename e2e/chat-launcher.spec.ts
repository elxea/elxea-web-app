import { test, expect, type Page } from "@playwright/test";

/**
 * Chat launcher + footer reachability.
 *
 * The defect this exists for: the desktop chat rendered as a full-width strip
 * fixed to `bottom-0` with no `pointer-events-none`, so a 108px band across the
 * whole viewport swallowed clicks — including the footer's legal links
 * (特商法表記 among them). `e2e/smoke.spec.ts` asserted those links with
 * `toBeVisible()` and passed the entire time, because visibility says nothing
 * about whether anything is stacked on top.
 *
 * So every assertion here that matters is a real `click()`. Playwright's click
 * performs a hit-target check and fails when another element would receive the
 * event, which is the only thing that actually pins this bug down.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const LEGAL_ROUTES = ["tokushoho", "privacy", "terms", "returns"] as const;

/**
 * Dismisses the cookie banner *before* the first paint.
 *
 * Without this the banner (also bottom-fixed, at z-50) covers the same footer
 * rows, and a failure here would be blamed on the chat UI. `addInitScript` runs
 * before page scripts on every navigation, so it must be registered before
 * `goto`. "all" is one of the accepted spellings in `lib/consent.ts`.
 */
async function acceptCookies(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cookie-consent", "all");
    } catch {
      // storage-blocked contexts fall back to the banner; not this spec's case
    }
  });
}

/**
 * Keeps chat instrumentation inside the runner. The launcher posts a
 * `chat_open` event, which the app proxies on to the CX agent; nothing should
 * leave the machine during a test.
 */
async function stubChatEvents(page: Page) {
  await page.route("**/api/chat/event", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }),
  );
}

async function setup(page: Page) {
  await acceptCookies(page);
  await stubChatEvents(page);
}

const launcher = (page: Page) => page.locator('[data-slot="chat-launcher"]');

/**
 * `boundingBox()` returns null for a hidden element and does not wait for it to
 * become visible. `useIsMobile()` starts as `false`, so the mobile tree only
 * mounts after hydration — reading the box without waiting first is a race.
 */
async function visibleBox(page: Page, selector: string) {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// ---------------------------------------------------------------------------

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  // AC-1
  test("every footer legal link is actually clickable", async ({ page }) => {
    // Four full page loads against `next dev`, each compiling a fresh route.
    test.setTimeout(150_000);

    for (const route of LEGAL_ROUTES) {
      await setup(page);
      await page.goto("/ja");

      // Scoped to the Legal nav rather than `footer`: in dev the Next.js error
      // overlay ships its own <footer>, and click() auto-scrolls anyway.
      const link = page
        .locator('nav[aria-label="Legal"]')
        .locator(`a[href$="/legal/${route}"]`);

      // Not toBeVisible(): the whole point is the hit-target check inside click.
      await link.click();
      // The hit-target check inside click() is the assertion that matters; this
      // only confirms the click went somewhere. The generous timeout is for
      // `next dev` compiling each legal route on first visit, which has nothing
      // to do with what is being tested.
      await expect(page).toHaveURL(new RegExp(`/legal/${route}`), {
        timeout: 30_000,
      });
    }
  });

  // AC-2
  test("the old full-width input strip is gone", async ({ page }) => {
    await setup(page);
    await page.goto("/ja");

    await expect(page.locator('[data-slot="chat-input-bar"]')).toHaveCount(0);
  });

  // AC-3
  test("launcher opens a panel anchored bottom-right, clear of the header", async ({
    page,
  }) => {
    await setup(page);
    await page.goto("/ja");

    await expect(launcher(page)).toBeVisible();
    await launcher(page).click();

    const box = await visibleBox(page, '[data-slot="chat-panel"]');

    // Inside the viewport on all four sides.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(DESKTOP.width);
    expect(box.y + box.height).toBeLessThanOrEqual(DESKTOP.height);

    // Anchored to the bottom-right corner, not centred.
    expect(DESKTOP.width - (box.x + box.width)).toBeLessThanOrEqual(48);
    expect(DESKTOP.height - (box.y + box.height)).toBeLessThanOrEqual(48);

    // Does not collide with the sticky header.
    const header = (await page.locator("header").first().boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  });

  // AC-4
  test("launcher meets the minimum touch target", async ({ page }) => {
    await setup(page);
    await page.goto("/ja");

    const box = await visibleBox(page, '[data-slot="chat-launcher"]');
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("launcher carries its label on desktop", async ({ page }) => {
    await setup(page);
    await page.goto("/ja");

    await expect(page.locator('[data-slot="chat-launcher-label"]')).toBeVisible();
  });

  // AC-6
  test("launcher stays clickable while the cookie banner is up", async ({
    page,
  }) => {
    // Deliberately no acceptCookies() — this is the first-visit case, where the
    // banner renders at z-50 over a z-40 launcher.
    await stubChatEvents(page);
    await page.goto("/ja");

    await expect(page.locator('[data-slot="cookie-consent"]')).toBeVisible();

    await launcher(page).click();
    await expect(page.locator('[data-slot="chat-panel"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe("mobile", () => {
  test.use({ viewport: MOBILE });

  // AC-1
  test("every footer legal link is actually clickable", async ({ page }) => {
    // Four full page loads against `next dev`, each compiling a fresh route.
    test.setTimeout(150_000);

    for (const route of LEGAL_ROUTES) {
      await setup(page);
      await page.goto("/ja");

      // Scoped to the Legal nav rather than `footer`: in dev the Next.js error
      // overlay ships its own <footer>, and click() auto-scrolls anyway.
      const link = page
        .locator('nav[aria-label="Legal"]')
        .locator(`a[href$="/legal/${route}"]`);

      await link.click();
      // The hit-target check inside click() is the assertion that matters; this
      // only confirms the click went somewhere. The generous timeout is for
      // `next dev` compiling each legal route on first visit, which has nothing
      // to do with what is being tested.
      await expect(page).toHaveURL(new RegExp(`/legal/${route}`), {
        timeout: 30_000,
      });
    }
  });

  // AC-3
  test("launcher opens the fullscreen panel", async ({ page }) => {
    await setup(page);
    await page.goto("/ja");

    await expect(launcher(page)).toBeVisible();
    await launcher(page).click();

    await expect(page.locator('[data-slot="chat-panel-mobile"]')).toBeVisible();
  });

  // AC-4 + AC-5
  test("launcher sits in the bottom-right at a usable size", async ({ page }) => {
    await setup(page);
    await page.goto("/ja");

    const box = await visibleBox(page, '[data-slot="chat-launcher"]');

    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    const rightGap = MOBILE.width - (box.x + box.width);
    expect(rightGap).toBeGreaterThanOrEqual(12);
    expect(rightGap).toBeLessThanOrEqual(20);

    // The lower bound allows for `env(safe-area-inset-bottom)` being 0 in a
    // headless Chromium; the upper bound is what a home-indicator device adds.
    const bottomGap = MOBILE.height - (box.y + box.height);
    expect(bottomGap).toBeGreaterThanOrEqual(16);
    expect(bottomGap).toBeLessThanOrEqual(60);
  });

  test("launcher keeps the icon-only circle (no desktop label)", async ({
    page,
  }) => {
    await setup(page);
    await page.goto("/ja");

    // The label is in the DOM at every width (`hidden md:inline`), so this has
    // to be a visibility assertion, not a text assertion.
    await expect(page.locator('[data-slot="chat-launcher-label"]')).toBeHidden();

    const box = await visibleBox(page, '[data-slot="chat-launcher"]');
    expect(box.width).toBeLessThanOrEqual(56);
  });
});
