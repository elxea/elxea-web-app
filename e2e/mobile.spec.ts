import { test, expect, type Locator, type Page } from "@playwright/test";

import { unmetPrecondition } from "./support/preconditions";

test.describe("Mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test("homepage loads on mobile", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("hamburger menu is visible and desktop nav is hidden", async ({
    page,
  }) => {
    await page.goto("/ja");

    // Hamburger menu button should be visible
    const menuButton = page.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();

    // Desktop nav should be hidden on mobile
    const desktopNav = page.locator("header nav");
    await expect(desktopNav).toBeHidden();
  });

  test("mobile menu opens and shows navigation links", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu
    await page.getByRole("button", { name: "Menu" }).click();

    // Wait for the sheet to open
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Navigation links should be visible in mobile menu
    await expect(sheet.getByText("商品一覧")).toBeVisible();
    await expect(sheet.getByText("ジャーナル")).toBeVisible();
    // 農家一覧の廃止 (2026-08-14) で nav 項目からも外した。
    await expect(sheet.getByText("農家")).toHaveCount(0);
    await expect(sheet.getByText("イベント")).toBeVisible();
  });

  test("mobile menu navigation works and closes menu", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Click products link
    await sheet.getByText("商品一覧").click();
    await page.waitForURL(/\/ja\/products/);

    // Menu should close after navigation
    await expect(sheet).toBeHidden();

    // Products page should load
    await expect(page.locator("h1")).toContainText("商品一覧");
  });

  test("cart link is always visible on mobile", async ({ page }) => {
    await page.goto("/ja");

    const header = page.locator("header");
    await expect(header.getByText("カート")).toBeVisible();
  });

  test("product listing page is responsive", async ({ page }) => {
    await page.goto("/ja/products");
    await expect(page.locator("h1")).toContainText("商品一覧");

    // Product cards should be visible
    const productLinks = page.locator("a[href*='/products/']");
    const count = await productLinks.count();
    if (count > 0) {
      await expect(productLinks.first()).toBeVisible();
    }
  });

  test("product detail page is usable on mobile", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip(true, "商品一覧に商品カードが無い — Shopify に公開商品が必要です");
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Title should be visible
    await expect(page.locator("h1")).toBeVisible();

    // Add to cart or sold out button should be visible
    const addToCart = page.getByText("カートに追加");
    const subscribe = page.getByText("定期購入する");
    const soldOut = page.getByText("売り切れ");
    const hasAction =
      (await addToCart.isVisible().catch(() => false)) ||
      (await subscribe.isVisible().catch(() => false)) ||
      (await soldOut.isVisible().catch(() => false));
    expect(hasAction).toBeTruthy();
  });

  test("footer is accessible on mobile", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");

    // Scroll to footer
    await footer.scrollIntoViewIfNeeded();

    await expect(footer.getByText("ショップ")).toBeVisible();
    await expect(footer.getByText("コンテンツ")).toBeVisible();
    await expect(footer.getByText("サポート")).toBeVisible();
    await expect(footer.getByText(/© \d{4} elxea/)).toBeVisible();
  });

  test("search page works on mobile", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu to access search
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Click search in mobile menu
    await sheet.getByText("検索").click();
    await page.waitForURL(/\/ja\/search/);

    // Search input should be visible
    const searchInput = page.locator("#search-input");
    await expect(searchInput).toBeVisible();

    // Type and search
    await searchInput.fill("tea");
    await searchInput.press("Enter");
    await page.waitForURL(/\/ja\/search\?q=tea/);
  });
});

// ---------------------------------------------------------------------------
// 画面端に居座る面の重なり (occlusion) — 実ページで矩形を実測する
// ---------------------------------------------------------------------------
/**
 * なぜ e2e にしか置けないのか (2026-08-17 新設)
 *
 * 音声ドック / チャット / Cookie 同意 は **ルートレイアウトに常駐する固定要素**
 * (`app/[locale]/layout.tsx`) で、互いに同じ stacking context に載る。既存の
 * 品質ゲート (unit / Storybook / Chromatic / design-kit) はすべて**部品を単体で**
 * 見るため、「この 3 つが同時に載った実ページ」を見る目が 1 つも無かった。
 * 2026-08-17 に見つかった 3 件の不具合 (チャット入力欄が音声バーに覆われて
 * 押せない / モーダルの下部が音声バーに覆われる / 下端 UI が宙に浮く) は
 * どれも部品単体では**原理的に再現しない**種類で、抜けた原因がこれ。
 *
 * 検査の作り方は 2 種類を使い分ける:
 *
 * 1. **矩形の非交差** — 縦に積んで共存させる面 (音声バー / Cookie 同意 /
 *    チャットランチャ / PC のチャット入力バー)。重なったら即不具合なので、
 *    boundingBox の交差面積が 0 であることを assert する。
 * 2. **最前面の同一性 (hit test)** — 全画面を覆う面 (全画面チャット / Sheet や
 *    Dialog)。これらは矩形が必ず重なるので、非交差では検査できない。重なった
 *    領域の中心で `document.elementFromPoint` を引き、**そこに居るのが手前に
 *    出るべき面であって音声バーではない**ことを assert する。
 *
 * 退避 (`data-retreated`) の検査は **属性ではなく矩形の位置**で行う。属性は
 * 正しいのに実描画がずれている事故 (CSS 側の translate が効いていない等) は
 * 属性を見ているだけでは拾えない。
 */

type Rect = { x: number; y: number; width: number; height: number };

const SP_VIEWPORT = { width: 390, height: 844 };

/** 音声ドックが出ている記事。CMS 上で `audioUrl` を持つ記事が前提。 */
const KNOWN_AUDIO_ARTICLE = "/ja/journal/tsushima-oishi-farm-interview";

/**
 * 無音の WAV を組み立てる。
 *
 * 実在の音源 (Sanity 経由の外部 URL) に依存すると、CI からの外部到達性・帯域・
 * 音源の差し替えでテストが揺れる。`resourceType() === "media"` の要求を全部
 * これで差し替えることで、**本物の再生 (`playing` イベントまで到達)** を
 * ネットワークに依存せず再現する。無音なので CI の音声デバイス有無も問わない。
 */
function silentWav(seconds = 30, sampleRate = 8000): Buffer {
  const samples = seconds * sampleRate;
  const buf = Buffer.alloc(44 + samples);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34); // 8bit
  buf.write("data", 36);
  buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44); // 8bit PCM の無音は 0x80
  return buf;
}

async function mockAudioRequests(page: Page): Promise<void> {
  const wav = silentWav();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "media") {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
      return;
    }
    await route.fallback();
  });
}

/** アニメーションが終わって矩形が動かなくなるまで待ってから返す。 */
async function stableBox(locator: Locator, what: string): Promise<Rect> {
  let last: Rect | null = null;
  let previousKey = "";
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        last = box;
        if (!box) {
          previousKey = "";
          return false;
        }
        const key = [box.x, box.y, box.width, box.height]
          .map((n) => Math.round(n))
          .join(",");
        const stable = key === previousKey;
        previousKey = key;
        return stable;
      },
      { message: `${what} の矩形が安定しない`, timeout: 10_000 },
    )
    .toBe(true);
  if (!last) unmetPrecondition(`${what} に矩形が無い`);
  return last;
}

/** 2 つの矩形が重なっている面積 (px^2)。0 なら接していても重なっていない。 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
}

function describeRect(r: Rect): string {
  return `x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`;
}

/**
 * 音声ドックを **実際に再生している状態** にして、その矩形を返す。
 *
 * 「音源が選ばれてバーが出た」だけでは足りないので `data-state="playing"` まで
 * 待つ (`components/audio/audio-player.tsx` が provider の status を DOM に出す)。
 */
async function startAudioPlayback(page: Page): Promise<Rect> {
  await page.goto(KNOWN_AUDIO_ARTICLE, { waitUntil: "domcontentloaded" });

  const player = page.locator('[data-slot="audio-player"]').first();
  await requireVisibleWithin(
    player,
    `${KNOWN_AUDIO_ARTICLE} に記事音声 (AudioBlock) がある — CMS の audioUrl が前提`,
  );

  const play = player.locator('button[aria-label="再生"]');
  const bar = page.locator('[data-slot="audio-dock-bar"]');

  // hydration 前のクリックは握られて消えるので、バーが出るまで押し直す。
  await expect(async () => {
    await play.click();
    await expect(bar).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await expect(player).toHaveAttribute("data-state", "playing", { timeout: 20_000 });

  const dock = await stableBox(bar, "音声ドックのバー");
  // 出きった状態は画面内の最下段に居る。ここがズレていると以降の検査の前提が崩れる。
  const viewportHeight = page.viewportSize()?.height ?? SP_VIEWPORT.height;
  expect(
    Math.round(dock.y + dock.height),
    `音声ドックが画面下端に着いていない (${describeRect(dock)})`,
  ).toBe(viewportHeight);
  return dock;
}

/**
 * 重なった領域の中心で「どちらが手前に描かれているか」を描画順で調べる。
 *
 * ここで `document.elementFromPoint` (単数) を使ってはいけない。Radix の
 * Dialog / Sheet は開いている間 `body` に `pointer-events: none` を敷き、
 * 自分の面だけ `auto` に戻す。その結果、**z-index で音声バーが手前に描かれて
 * いても単数版は必ずダイアログを返す** (2026-08-17 実測: dock z=1020 /
 * sheet z=50 の状態でも `elementFromPoint` は sheet-content を返した)。
 * つまり単数版では「見た目が覆われている」不具合を検出できない。
 *
 * 複数版 (`document.elementsFromPoint`) は **手前から奥の順**に返るが、これも
 * `pointer-events: none` の要素を落とすため、そのままでは音声バーが一覧に
 * 現れない (実測: 壊れた状態でも一覧は [sheet-content, sheet-overlay, HTML]
 * だけで、音声バーが 1 度も出てこなかった)。
 *
 * そこで **計測の瞬間だけ `body` の `pointer-events` ロックを外し**、複数版で
 * 順位を比べ、直後に元へ戻す。問うのが「操作の可否」ではなく「描画順」になる
 * ので Radix のロックの有無に依存しない。ロックは同じ evaluate の中で必ず
 * 復元するため、テストの続きに副作用は残らない。
 */
async function paintOrderInOverlap(
  page: Page,
  frontSelector: string,
  backSelector: string,
): Promise<{
  point: [number, number];
  frontIndex: number;
  backIndex: number;
  order: string[];
}> {
  const result = await page.evaluate(
    ({ frontSel, backSel }) => {
      const front = document.querySelector(frontSel);
      const back = document.querySelector(backSel);
      if (!front || !back) return null;
      const fr = front.getBoundingClientRect();
      const br = back.getBoundingClientRect();
      const x1 = Math.max(fr.left, br.left);
      const x2 = Math.min(fr.right, br.right);
      const y1 = Math.max(fr.top, br.top);
      const y2 = Math.min(fr.bottom, br.bottom);
      if (x2 <= x1 || y2 <= y1) return null;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      // Radix が敷く pointer-events ロックを計測の間だけ外す (必ず戻す)。
      const previousPointerEvents = document.body.style.pointerEvents;
      document.body.style.pointerEvents = "";
      let stack: Element[];
      try {
        stack = document.elementsFromPoint(cx, cy);
      } finally {
        document.body.style.pointerEvents = previousPointerEvents;
      }
      const indexOf = (sel: string) => stack.findIndex((el) => el.closest(sel));
      return {
        point: [Math.round(cx), Math.round(cy)] as [number, number],
        frontIndex: indexOf(frontSel),
        backIndex: indexOf(backSel),
        order: stack.map((el) => el.getAttribute("data-slot") ?? el.tagName),
      };
    },
    { frontSel: frontSelector, backSel: backSelector },
  );
  if (!result) {
    unmetPrecondition(
      `${frontSelector} と ${backSelector} が重なっていない — 描画順の検査の前提が崩れている`,
    );
  }
  return result;
}

/**
 * 「出るまで待つ」版の前提確認。
 *
 * `requireVisible` は待たずに 1 回見るだけなので、SSR 直後の hydration や
 * 下端 UI の出現アニメーションと競合して偽陰性 (存在するのに precondition 失敗)
 * になる。ここでは待ってから、それでも出ないときだけ前提失敗にする。
 */
async function requireVisibleWithin(
  locator: Locator,
  what: string,
  timeout = 30_000,
): Promise<void> {
  const appeared = await locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) unmetPrecondition(what);
}

/** その座標を押したときに実際に受け取る要素が自分自身 (か自分の中) か。 */
async function isHitTarget(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === el || el.contains(top) || top.contains(el));
  });
}

test.describe("Bottom-fixed occlusion (SP)", () => {
  test.use({
    viewport: SP_VIEWPORT,
    isMobile: true,
    hasTouch: true,
    // 退避を **矩形の位置**で判定するので、移動距離を 0 にする設定を明示的に外す。
    // `prefers-reduced-motion: reduce` では `--motion-travel: 0` になり
    // (app/globals.css)、退避は opacity + inert だけで表れて位置は動かない。
    reducedMotion: "no-preference",
  });

  test.beforeEach(async ({ page }) => {
    await mockAudioRequests(page);
  });

  test("音声ドック再生中でも Cookie 同意バーが覆われない", async ({ page }) => {
    const dock = await startAudioPlayback(page);

    const consent = page.locator('[data-slot="cookie-consent"]');
    await requireVisibleWithin(consent, "初回訪問なので Cookie 同意バーが出ている");
    const consentBox = await stableBox(consent, "Cookie 同意バー");

    expect(
      overlapArea(dock, consentBox),
      `Cookie 同意バーが音声ドックと重なっている (consent ${describeRect(consentBox)} / dock ${describeRect(dock)})`,
    ).toBe(0);

    // 同意バーは音声ドックの真上に積まれる (下端は音声ドックの上端と一致)。
    expect(Math.round(consentBox.y + consentBox.height)).toBe(Math.round(dock.y));

    // 幾何が合っていても最前面が奪われていれば押せない。実際の当たりも見る。
    const accept = consent.getByRole("button").last();
    expect(await isHitTarget(accept), "同意ボタンが最前面に居ない").toBe(true);
  });

  test("音声ドック再生中でもチャットランチャが覆われない", async ({ page }) => {
    const dock = await startAudioPlayback(page);

    const launcher = page.locator('[data-slot="chat-launcher"]');
    await requireVisibleWithin(launcher, "SP でチャットランチャが出ている");
    const launcherBox = await stableBox(launcher, "チャットランチャ");

    expect(
      overlapArea(dock, launcherBox),
      `チャットランチャが音声ドックと重なっている (launcher ${describeRect(launcherBox)} / dock ${describeRect(dock)})`,
    ).toBe(0);
    expect(await isHitTarget(launcher), "チャットランチャが最前面に居ない").toBe(true);
  });

  test("全画面チャットを開くと音声ドックは画面外へ退避し、入力欄が操作できる", async ({
    page,
  }) => {
    await startAudioPlayback(page);

    await page.locator('[data-slot="chat-launcher"]').click();
    const panel = page.locator('[data-slot="chat-panel-mobile"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const bar = page.locator('[data-slot="audio-dock-bar"]');
    const dock = await stableBox(bar, "退避後の音声ドック");

    const input = page.locator('[data-slot="chat-input-bar-mobile"] input');
    await expect(input).toBeVisible();
    const inputBox = await stableBox(input, "全画面チャットの入力欄");

    // --- 実害を先に見る -----------------------------------------------------
    // 2026-08-17 に報告された症状そのもの:「入力欄が音声バーに覆われて押せない」。
    // 直し方 (退避 / 共存) より前にこれを assert しておかないと、直し方を
    // 取り替えたときに症状の検査が消えてしまう。
    expect(
      overlapArea(dock, inputBox),
      `チャット入力欄が音声ドックと重なっている (input ${describeRect(inputBox)} / dock ${describeRect(dock)})`,
    ).toBe(0);

    expect(
      await isHitTarget(input),
      "チャット入力欄が最前面に居ない (別の面が覆っている)",
    ).toBe(true);

    // 覆われていないだけでなく、実際に文字が入ること。
    await input.click();
    await input.fill("テスト");
    await expect(input).toHaveValue("テスト");

    // --- 直し方 (退避) が効いているか --------------------------------------
    // 退避の判定は矩形の位置で行う (属性だけを見ると、属性は正しいのに
    // 実描画が動いていない事故を拾えない)。上端が画面下端以下 = 完全に画面外。
    expect(
      Math.round(dock.y),
      `音声ドックが画面外へ退避していない (${describeRect(dock)})`,
    ).toBeGreaterThanOrEqual(SP_VIEWPORT.height);

    // 属性は補助的に併せて見る (退避の意図が DOM に出ているか)。
    await expect(bar).toHaveAttribute("data-retreated", "true");
  });

  test("音声ドック再生中でもモバイルメニュー (Sheet) が手前に出る", async ({ page }) => {
    await startAudioPlayback(page);

    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await stableBox(dialog, "モバイルメニューの Sheet");

    // 全画面を覆う面なので矩形は必ず重なる。重なった領域で描画順を見る。
    const paint = await paintOrderInOverlap(
      page,
      '[role="dialog"]',
      '[data-slot="audio-dock-bar"]',
    );
    // 両方が一覧に現れていること (どちらかが -1 なら計測自体が壊れている)。
    expect(
      Math.min(paint.frontIndex, paint.backIndex),
      `描画順の一覧に Sheet と音声ドックの両方が現れていない (一覧=[${paint.order.join(", ")}])`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      paint.frontIndex,
      `Sheet と音声ドックが重なった座標 (${paint.point.join(",")}) で音声ドックが手前に描かれている。` +
        `描画順 (手前→奥) = [${paint.order.join(", ")}]。` +
        `shadcn の生 z-50 が名前付きレイヤー (--z-modal) に接続されていないと必ずこうなる ` +
        `(50 < --z-sticky 1020)。`,
    ).toBeLessThan(paint.backIndex);
  });
});

test.describe("Bottom-fixed coexistence (PC)", () => {
  // PC は退避させず **縦に積んで共存** させる (Setaka 裁定 2026-08-17)。
  // SP 側の退避を直すときに PC の共存を壊さないための対の検査。
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });

  test("音声ドックとチャット入力バーが縦に積まれて共存する", async ({ page }) => {
    await mockAudioRequests(page);
    await startAudioPlayback(page);

    const bar = page.locator('[data-slot="audio-dock-bar"]');
    const dock = await stableBox(bar, "音声ドックのバー");

    const chatBar = page.locator('[data-slot="chat-input-bar"]');
    await requireVisibleWithin(chatBar, "PC でチャット入力バーが出ている");
    const chatBox = await stableBox(chatBar, "PC のチャット入力バー");

    // 実害を先に: 重なっていないこと・入力欄が押せること。
    expect(
      overlapArea(dock, chatBox),
      `PC のチャット入力バーが音声ドックと重なっている (chat ${describeRect(chatBox)} / dock ${describeRect(dock)})`,
    ).toBe(0);
    expect(
      Math.round(chatBox.y + chatBox.height),
      "チャット入力バーが音声ドックより下に居る",
    ).toBeLessThanOrEqual(Math.round(dock.y));
    expect(
      await isHitTarget(chatBar.locator("input").first()),
      "PC のチャット入力欄が最前面に居ない",
    ).toBe(true);

    // PC は退避させず共存させる (SP の退避を直すときにここを壊さないための対)。
    await expect(bar).toHaveAttribute("data-retreated", "false");
  });
});

// Tablet viewport — use viewport override instead of devices to avoid worker split
test.describe("Tablet viewport", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("homepage loads on tablet", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("navigation is appropriate for tablet width", async ({ page }) => {
    await page.goto("/ja");

    // At 768px (md breakpoint), desktop nav should be visible
    const desktopNav = page.locator("header nav");
    const menuButton = page.getByRole("button", { name: "Menu" });

    const hasDesktopNav = await desktopNav.isVisible().catch(() => false);
    const hasMobileMenu = await menuButton.isVisible().catch(() => false);

    // Either desktop nav or mobile menu should be accessible
    expect(hasDesktopNav || hasMobileMenu).toBeTruthy();
  });
});
