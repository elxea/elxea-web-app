import { test, expect, type Page } from "@playwright/test";

/**
 * 「静止しているとき、チャットの入口が本文の上に居ない」を縛る。
 *
 * ## 何を守っているか (通しテスト E-1 / 2026-08-27)
 *
 * 本番 SP390 の /ja/products を 5 地点で実測したところ、48px のチャットボタンが
 * 商品カード画像に **完全に重なって** いた (scrollY 504 / 756 / 1009 で重なり
 * 1,619 / 2,166 / 2,304 px^2 = ボタン面積の 70% / 94% / 100%)。原因は退避の
 * 規則が「手が止まったら戻る」を持っていたこと — 動いている間だけ隠しても、
 * **人が見るのは止まっているとき**なので実害は消えない。
 *
 * SP の一覧は 2 列で画面幅を敷き詰めるため、右下 48px を空けられる場所が
 * そもそも無い (カード画像 x=203..374 / ランチャ x=326..374)。位置をずらす案も
 * 縮小・半透明化案も採れないので、静止時は退いたままにした。規則の正本は
 * `hooks/use-retreat-on-scroll.ts`、判断の単体テストは
 * `__tests__/chat-launcher-retreat.test.ts`。ここは**実ブラウザの矩形**で
 * 裏を取る (規則が正しくても CSS が効いていなければ実害は残るため)。
 */

const SP = { width: 390, height: 844 } as const;

/** 監査が実測した 5 地点。数値を変えるとこの検査は別物になるので固定する。 */
const AUDIT_SCROLL_POSITIONS = [0, 252, 504, 756, 1009] as const;

/** `hooks/use-retreat-on-scroll.ts` の RETREAT_SETTLE_MS より十分長く待つ。 */
const SETTLE_MS = 700;

type Rect = { x: number; y: number; width: number; height: number };

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

function describeRect(r: Rect): string {
  return `x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`;
}

/**
 * 指定位置までスクロールし、手が止まった状態にしてから
 * 「見えているランチャの矩形」と「商品カード画像の矩形」を返す。
 *
 * 見えているかどうかは `opacity` と `pointer-events` で判定する。退避は DOM から
 * 外さずに `transform` / `opacity` だけを切り替える設計なので、要素の存在では
 * 判定できない (存在で見ると「隠れていても居る」と誤読して常に落ちる)。
 */
async function measureAtRest(page: Page, scrollY: number) {
  return page.evaluate(
    async ({ y, settleMs }) => {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, settleMs));

      const btn = document.querySelector('[data-slot="chat-launcher"]');
      const style = btn ? getComputedStyle(btn) : null;
      const shown =
        !!btn && !!style && Number(style.opacity) > 0.01 && style.pointerEvents !== "none";
      const rect = btn ? btn.getBoundingClientRect() : null;

      const media = [...document.querySelectorAll('a[href*="/products/"] img')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          alt: (el as HTMLImageElement).alt.slice(0, 24),
        };
      });

      return {
        scrollY: Math.round(window.scrollY),
        shown,
        launcher: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null,
        media,
      };
    },
    { y: scrollY, settleMs: SETTLE_MS },
  );
}

/**
 * 商品一覧を開き、**退避の判定が効き始めるまで**待つ。
 *
 * 判定はクライアント側の hook が持っており、hydration が終わるまでスクロールを
 * 拾えない。待たずに測ると「まだ誰も見ていないので出たまま」を「戻ってきた」と
 * 読み違え、直っていても落ちる / 壊れていても通る。ランチャが実際に描かれる
 * ところまで待ってから測る。
 *
 * Cookie の選択は済ませておく。**初回訪問の同意バーが出ている間だけ**、ランチャは
 * バーの上へ持ち上がって (実測 y=776 → 655) 1 段目のカードに乗る。これは
 * 「下端の面どうしを重ねない」(`hooks/use-bottom-stack-slot.ts`) の帰結で、
 * ランチャと同意バーが**両方押せること**は `e2e/mobile.spec.ts` が別途縛って
 * いる。選択が済めば消える一過性の状態なので、ここでは扱わない — この検査が
 * 見るのは、監査が本番で測ったのと同じ「2 回目以降の訪問」である。
 */
async function openProducts(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cookie-consent", "all");
    } catch {
      // storage を塞いだ環境ではバーが出る。この spec の対象外。
    }
  });
  await page.goto("/ja/products", { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-slot="chat-launcher"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(SETTLE_MS);
}

test.describe("チャットの入口が静止時に商品カードを覆わない (SP)", () => {
  test.use({ viewport: SP, isMobile: true, reducedMotion: "no-preference" });
  test.describe.configure({ timeout: 90_000 });

  test("監査の 5 地点すべてで、止まった状態の重なりが 0", async ({ page }) => {
    await openProducts(page);

    /* 画像が 1 枚も無いなら、この検査は何も確かめていない。黙って通さず
       skip で理由を残す (CI の skip サマリが拾う)。 */
    const mediaCount = await page.locator('a[href*="/products/"] img').count();
    test.skip(
      mediaCount === 0,
      "商品カードが 1 枚も出ていない (Shopify 未接続)。重なりを測る対象が無い",
    );

    for (const scrollY of AUDIT_SCROLL_POSITIONS) {
      const shot = await measureAtRest(page, scrollY);

      /* 退いているなら重なりようがない。ここで `continue` せずに 0 を assert
         するのは、「見えているのに重なっていない」ケース (最上部) も同じ物差しで
         見たいため。 */
      if (!shot.shown || !shot.launcher) continue;

      for (const media of shot.media) {
        expect(
          overlapArea(shot.launcher, media),
          `scrollY=${shot.scrollY} でチャットの入口が商品カード画像に重なっている ` +
            `(launcher ${describeRect(shot.launcher)} / image ${describeRect(media)} ` +
            `"${media.alt}")。静止時は退いたままにすること ` +
            `(hooks/use-retreat-on-scroll.ts の retreatOnSettle)。`,
        ).toBe(0);
      }
    }
  });

  test("上へ動かせば呼び戻せる (隠しっぱなしにはしない)", async ({ page }) => {
    await openProducts(page);

    /* 「静止時は出さない」だけを守ると、入口が二度と出てこない実装でも検査は
       通ってしまう。呼び戻す手段が生きていることを対で縛る。 */
    const hidden = await measureAtRest(page, 900);
    expect(hidden.shown, "下へ動いたあと静止したら退いている").toBe(false);

    const summoned = await measureAtRest(page, 700);
    expect(summoned.shown, "上へ動かしたら出てくる").toBe(true);
  });

  test("最上部では出したまま (下端に本文が流れてこないので隠す理由が無い)", async ({
    page,
  }) => {
    await openProducts(page);

    await measureAtRest(page, 900);
    const top = await measureAtRest(page, 0);
    expect(top.shown, "先頭に戻ったら出ている").toBe(true);
  });
});
