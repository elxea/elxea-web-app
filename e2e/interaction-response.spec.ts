/**
 * 憲章 R9 — 台帳が宣言した「応答の出し方」を、**性質**として確かめる。
 *
 * ## なぜ壁時計 (「0.3 秒以内」) で測らないのか
 *
 * 初版の案は `IMMEDIATE_FEEDBACK_BUDGET_MS = 300` をそのまま assert するもの
 * だった。**それは成立しない。** このスイートの `webServer` は `pnpm dev`
 * (`playwright.config.ts`) で、`next dev` は**ルートを最初のリクエストで初めて
 * コンパイルする**。初回アクセスの壁時計は数百 ms〜秒単位で揺れるので、300ms の
 * 閾値は恒常的に flaky になり、`--retries=2` で握り潰されるか、そのうち誰も見ない
 * 赤になる。それは網羅表が S5 で批判した「見ていない緑」を別の形で作るだけである。
 *
 * ## 代わりに何を測るか — 時間ではなく依存関係
 *
 * 「押した瞬間に効く」の本質は速さではなく、**サーバの応答を待たずに画面が
 * 完成すること**である。これは時間ではなく依存関係の性質なので、機械の速さに
 * 一切左右されない形で確かめられる。
 *
 * | 台帳の `response` | assert する内容 | 判定方法 |
 * |---|---|---|
 * | `optimistic` | `observe` の**全要素**が、書き込みの往復を遮断した状態でも更新完了する | ネットワーク遮断 (時間非依存) |
 * | `asset-load` | 切替先アセットが**操作前に取得済み**である | 事前取得の有無 (時間非依存) |
 * | `sync-dom` | `observe` の全要素が、ネットワーク遮断下でも更新完了する | ネットワーク遮断 (時間非依存) |
 *
 * 予算値 `IMMEDIATE_FEEDBACK_BUDGET_MS` は**設計上の約束の正本として引き続き
 * 参照する**が、CI の assert は上表の性質検査に置き換える。壁時計での実測は
 * 本番 URL 相手の `staging-smoke` に置く場所であって、`pnpm dev` 相手に
 * 絶対時間を測らない、が原則。
 *
 * ## 台帳との配線
 *
 * 下の `SCENARIOS` は **台帳の id をキーに持つ**。台帳で `exempt` を外して
 * 応答を宣言した行は、ここに操作の仕方を書かないと
 * `__tests__/interaction-inventory.test.ts` が落ちる。**宣言だけして検査しない**
 * が原理的にできない形にしてある (宣言が増えるほど検査も増える)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  MEMBER_SESSION_CONFIGURED,
  MEMBER_SESSION_SKIP_REASON,
  STOREFRONT_CONFIGURED,
  addToCart,
  openPurchasableProduct,
} from "./support/preconditions";

type Interaction = {
  id: string;
  file: string;
  kind: string;
  name: string;
  response?: string;
  observe?: string[];
  exempt?: string;
};

/** 台帳。**この spec が台帳を実際に読んでいる**ことが配線 assert の対象。 */
export const INVENTORY: Interaction[] = JSON.parse(
  readFileSync(join(process.cwd(), "interaction-inventory.json"), "utf8"),
).interactions;

/**
 * 応答を宣言した行のうち、**画面で観測できるもの** (= e2e の対象)。
 *
 * `fire-and-forget` を外すのは、その宣言が「誰もこの往復を待っていない」を
 * 意味するから。待っている人が居ない操作に「押した瞬間どう見えるか」の検査を
 * 課すのは筋が通らない (先読みの引き金は画面を何も変えないのが正しい挙動)。
 * **exempt とは別物**で、これは応答を分類したうえで「観測対象が無い」と
 * 言っている状態。件数は `interaction-exempt` には入らない。
 */
export const OBSERVABLE_RESPONSES = new Set([
  "optimistic",
  "sync-dom",
  "asset-load",
  "router-nav",
  "pessimistic-commit",
  "pessimistic-form",
  "async-fetch",
]);

export const DECLARED = INVENTORY.filter(
  (row) => !row.exempt && row.response && OBSERVABLE_RESPONSES.has(row.response),
);

/**
 * 台帳の 1 行を、実際に「押す」ところまで持っていく手順。
 *
 * `requiresCart` は Shopify Storefront の資格情報を要する操作の印。CI には
 * 資格情報が無く (`ci.yml` は `PREVIEW_SEED_STOREFRONT=1` のみ)、カートへの
 * 書き込み (`cartCreate` / `cartLinesAdd`) は実ストアにしか無い。既存の
 * `Checkout happy path` と**同じ理由で同じ扱い** — 見本で代替すると検査そのものが
 * 消えるので、資格情報が無い環境では理由付きで skip する。skip は
 * `pnpm report:e2e-skips` で CI サマリに出るので不可視にはならない。
 */
export const SCENARIOS: Record<
  string,
  {
    requiresCart?: boolean;
    /**
     * 会員としてログインした状態を要する操作の印（顧客プロファイル 第1段）。
     * `requiresCart` と同じ理由で同じ扱い — 資格情報が無い環境では理由付きで skip する。
     */
    requiresMemberSession?: boolean;
    /** 操作対象のページへ移動し、押せる状態にする。 */
    arrive: (page: Page) => Promise<void>;
    /** 実際に押す。 */
    act: (page: Page) => Promise<void>;
    /** 書き込みの往復として遮断する URL。 */
    blocks?: string;
  }
> = {
  "components/product/image-gallery.tsx#handler:onClick#2": {
    /* 網羅表 G1。サムネイルを押したときに大きい写真がすぐ出るのは、
       押す前にその 1 枚を取ってあるからで、速いからではない。
       だから「取ってあるか」を見る。 */
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await expect(page.locator("[role='listbox'] button").nth(1)).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[role='listbox'] button").nth(1).click();
    },
  },

  "components/catalog/catalog-list.tsx#link:Link#3": {
    /* 網羅表 G6。「さらに N 件を表示」は一覧を丸ごと取り直すので着地までは
       時間がかかる。**その時間を短くするのではなく、押されたことを即座に
       見せる**のが `router-nav` の約束。遷移を保留したまま印が出るかを見る。 */
    blocks: "**/products**",
    arrive: async (page) => {
      await page.goto("/ja/products");
      await expect(page.locator("[data-slot='more-row-link']")).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='more-row-link']").click();
    },
  },

  "components/product/add-to-cart-button.tsx#handler:onClick#1": {
    requiresCart: true,
    blocks: "**/products/**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
    },
    act: async (page) => {
      await page.getByRole("button", { name: "カートに追加" }).click();
    },
  },

  "components/cart/cart-content.tsx#handler:onQuantityChange#1": {
    requiresCart: true,
    blocks: "**/cart**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await addToCart(page);
      await page.goto("/ja/cart");
      await expect(page.locator("[data-slot='cart-line']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: /\+1$/ }).first().click();
    },
  },

  "components/cart/cart-content.tsx#handler:onRemove#1": {
    requiresCart: true,
    blocks: "**/cart**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await addToCart(page);
      await page.goto("/ja/cart");
      await expect(page.locator("[data-slot='cart-line']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: "削除" }).first().click();
    },
  },

  /* --- 茶葉診断 (CDP 統合 Stage 4 / /ja/diagnosis) -------------------------
     Shopify も会員も要らない画面なので `requiresCart` は付かない = CI で実際に
     走る。段の進行は state だけで完結し (sync-dom)、ネットワークを待つのは
     最後の送信 1 手だけ (pessimistic-form)。その 2 つが混ざっていないことを
     ここで固定する。 */

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onClick#1": {
    /* 「はじめる」。welcome → Q1。 */
    arrive: async (page) => {
      await page.goto("/ja/diagnosis");
      await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: "はじめる" }).click();
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onChoose#1": {
    /* 選択肢を押すと段が進む (Q1 → Q2)。 */
    arrive: async (page) => {
      await startDiagnosis(page);
    },
    act: async (page) => {
      await chooseFirst(page);
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onClick#5": {
    /* 選択肢そのもの (onChoose#1 と同じ 1 操作を、押す側から見たもの)。
       **Q1 で押して段の入れ替わりを見る。**
       初版は「Q3 で押して aria-pressed を見る」にしていたが、`aria-pressed="true"`
       は**押す前に 1 件も存在しない**ので、旧値を読む段階で待ち続けて 30 秒の
       時間切れになった (run 33211864201)。観測先は押す前も後も在って中身が変わる
       ものにする。 */
    arrive: async (page) => {
      await startDiagnosis(page);
    },
    act: async (page) => {
      await chooseFirst(page);
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onClick#3": {
    /* 「戻る」。Q2 → Q1。サーバには触らない。 */
    arrive: async (page) => {
      await startDiagnosis(page);
      await chooseFirst(page);
      await expect(page.locator('[data-slot="diagnosis-step"][data-step="2"]')).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: "戻る" }).click();
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onClick#4": {
    /* 「結果を見る」。送信の往復を保留したまま、進行の印が出るかを見る。 */
    blocks: "**/api/diagnosis",
    arrive: async (page) => {
      await goToLastQuestion(page);
      await chooseFirst(page);
    },
    act: async (page) => {
      await page.locator('[data-slot="diagnosis-submit"]').click();
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#write:fetch:POST#1": {
    /* onClick#4 と同じ 1 操作 (押す側と書き込み側の両方が台帳に載るため)。 */
    blocks: "**/api/diagnosis",
    arrive: async (page) => {
      await goToLastQuestion(page);
      await chooseFirst(page);
    },
    act: async (page) => {
      await page.locator('[data-slot="diagnosis-submit"]').click();
    },
  },

  /* --- 顧客プロファイル 第1段 (/ja/account/this-month・/ja/account/safety) -----
     択一 #11 でログイン必須と確定した面なので、CI では `requiresMemberSession`
     により理由付きで skip される (資格情報のある環境でのみ走る)。手順を書いて
     あるのは、宣言だけして検査手順が無い状態を作らないため — 環境が整った
     瞬間に、書き換えなしでそのまま走る。 */

  "components/profile/cup-feedback-card.tsx#handler:onClick#1": {
    requiresMemberSession: true,
    /* 答えを選ぶのは state だけ。送信の往復を止めても選べる。 */
    blocks: "**/api/user/cup-feedback",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await expect(page.locator("[data-slot='cup-verdict']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='cup-verdict']").first().click();
    },
  },

  "components/profile/cup-feedback-card.tsx#handler:onClick#2": {
    requiresMemberSession: true,
    blocks: "**/api/user/cup-feedback",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      /* 「どこが」は合わなかった側を選んだときだけ出る (asksAspect)。 */
      await page.locator("[data-slot='cup-verdict']").last().click();
      await expect(page.locator("[data-slot='cup-aspect-choice']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='cup-aspect-choice']").first().click();
    },
  },

  "components/profile/cup-feedback-card.tsx#handler:onClick#3": {
    requiresMemberSession: true,
    blocks: "**/api/user/cup-feedback",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await page.locator("[data-slot='cup-verdict']").first().click();
      await expect(page.locator("[data-slot='cup-submit']").first()).toBeEnabled();
    },
    act: async (page) => {
      await page.locator("[data-slot='cup-submit']").first().click();
    },
  },

  "components/profile/cup-feedback-card.tsx#handler:onClick#4": {
    requiresMemberSession: true,
    blocks: "**/api/user/cup-feedback",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await expect(page.locator("[data-slot='cup-decline']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='cup-decline']").first().click();
    },
  },

  "components/profile/cup-feedback-card.tsx#write:fetch:POST#1": {
    requiresMemberSession: true,
    blocks: "**/api/user/cup-feedback",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await page.locator("[data-slot='cup-verdict']").first().click();
      await expect(page.locator("[data-slot='cup-submit']").first()).toBeEnabled();
    },
    act: async (page) => {
      await page.locator("[data-slot='cup-submit']").first().click();
    },
  },

  "components/profile/recipient-card.tsx#handler:onClick#1": {
    requiresMemberSession: true,
    blocks: "**/api/user/purchase-recipient",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await expect(page.locator("[data-slot='recipient-choice']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='recipient-choice']").first().click();
    },
  },

  "components/profile/recipient-card.tsx#write:fetch:POST#1": {
    requiresMemberSession: true,
    blocks: "**/api/user/purchase-recipient",
    arrive: async (page) => {
      await page.goto("/ja/account/this-month");
      await expect(page.locator("[data-slot='recipient-choice']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='recipient-choice']").first().click();
    },
  },

  "components/profile/safety-form.tsx#handler:onClick#1": {
    requiresMemberSession: true,
    blocks: "**/api/user/safety",
    arrive: async (page) => {
      await page.goto("/ja/account/safety");
      await expect(page.locator("[data-slot='safety-tag']").first()).toBeEnabled();
    },
    act: async (page) => {
      await page.locator("[data-slot='safety-tag']").first().click();
    },
  },

  "components/profile/safety-form.tsx#handler:onClick#2": {
    requiresMemberSession: true,
    blocks: "**/api/user/safety",
    arrive: async (page) => {
      await page.goto("/ja/account/safety");
      await expect(page.locator("[data-slot='safety-consent']")).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[data-slot='safety-consent']").click();
    },
  },

  "components/profile/safety-form.tsx#handler:onClick#3": {
    requiresMemberSession: true,
    blocks: "**/api/user/safety",
    arrive: async (page) => {
      await page.goto("/ja/account/safety");
      await page.locator("[data-slot='safety-tag']").first().click();
      await page.locator("[data-slot='safety-consent']").click();
      await expect(page.locator("[data-slot='safety-submit']")).toBeEnabled();
    },
    act: async (page) => {
      await page.locator("[data-slot='safety-submit']").click();
    },
  },

  "components/profile/safety-form.tsx#write:fetch:POST#1": {
    requiresMemberSession: true,
    blocks: "**/api/user/safety",
    arrive: async (page) => {
      await page.goto("/ja/account/safety");
      await page.locator("[data-slot='safety-tag']").first().click();
      await page.locator("[data-slot='safety-consent']").click();
      await expect(page.locator("[data-slot='safety-submit']")).toBeEnabled();
    },
    act: async (page) => {
      await page.locator("[data-slot='safety-submit']").click();
    },
  },

  "app/[locale]/diagnosis/diagnosis-form.tsx#handler:onClick#2": {
    /* 「もう一度診断する」。結果まで進めてから押す。ここだけ `arrive` が
       実際の送信を通す (結果の段に居ないと押せるものが無い)。 */
    arrive: async (page) => {
      await goToLastQuestion(page);
      await chooseFirst(page);
      await page.locator('[data-slot="diagnosis-submit"]').click();
      await expect(page.locator('[data-slot="diagnosis-persona"]')).toBeVisible({
        timeout: 15_000,
      });
    },
    act: async (page) => {
      await page.getByRole("button", { name: "もう一度診断する" }).click();
    },
  },
};

/* --- 茶葉診断の共通手順 ------------------------------------------------------ */

/** /ja/diagnosis を開き、Q1 まで進める。 */
async function startDiagnosis(page: Page) {
  await page.goto("/ja/diagnosis");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator('[data-slot="diagnosis-step"][data-step="1"]')).toBeVisible();
}

/** いま出ている設問の最初の選択肢を押す。 */
async function chooseFirst(page: Page) {
  await page.locator('[data-slot="diagnosis-choice"]').first().click();
}

/** 最後の設問 (Q3) まで進める。**Q3 は選んでも段が進まない**のが要点。 */
async function goToLastQuestion(page: Page) {
  await startDiagnosis(page);
  await chooseFirst(page); // Q1 → Q2
  await expect(page.locator('[data-slot="diagnosis-step"][data-step="2"]')).toBeVisible();
  await chooseFirst(page); // Q2 → Q3
  await expect(page.locator('[data-slot="diagnosis-step"][data-step="3"]')).toBeVisible();
}

/* -------------------------------------------------------------------------- */

/**
 * 楽観更新の性質検査 — **サーバを黙らせたまま画面が完成するか**。
 *
 * `page.route()` で書き込みの往復を保留 (応答を返さない) にしたうえで操作し、
 * `observe` の全要素が変化することを確かめる。1 つでも古いままなら不合格 —
 * それが「数量だけ即時で金額はサーバ待ち」(網羅表 G2) の姿である。
 */
async function assertOptimistic(
  page: Page,
  row: Interaction,
  scenario: (typeof SCENARIOS)[string],
) {
  await scenario.arrive(page);

  const observe = row.observe ?? [];
  expect(observe.length, `${row.id} は observe が空`).toBeGreaterThan(0);

  const before = await Promise.all(
    observe.map((selector) => page.locator(selector).first().textContent().catch(() => null)),
  );

  /* 往復を**永久に保留**する。中断 (abort) ではなく保留にするのは、
     「失敗したから巻き戻した」ではなく「返事が来ないあいだ」を見たいから。 */
  await page.route(scenario.blocks ?? "**/*", async (route, request) => {
    if (request.method() === "GET") return route.continue();
    /* 応答を返さない = サーバは沈黙したまま。 */
    await new Promise(() => {});
  });

  await scenario.act(page);

  for (const [i, selector] of observe.entries()) {
    const target = page.locator(selector).first();
    const label =
      `${row.id}: ${selector} がサーバの往復を待っている ` +
      "(楽観更新が画面の描く項目を覆っていない = 網羅表 G2 と同じ形)";

    /* **`not.toHaveText(旧値)` だけでは弱い。**
       要素が消えた・空になった・そもそも selector が 0 件、のいずれでも
       「旧値と違う」は成立してしまう。つまり画面が壊れたときに緑になる向きが
       ある — この spec が無くそうとしている「見ていない緑」そのもの。
       だから (1) 見えている (2) 中身が空でない (3) 旧値と違う、の 3 つを見る。
       行が消えるのが正しい操作 (カート削除の cart-line) は数が変わるので、
       「見えている」は最初の 1 件に対してだけ課す。 */
    await expect(target, `${label} — 要素が見えなくなった`).toBeVisible({ timeout: 10_000 });
    await expect(target, label).not.toHaveText(before[i] ?? "", { timeout: 10_000 });
    await expect(target, `${label} — 中身が空になった`).not.toHaveText("", { timeout: 10_000 });
  }
}

/**
 * 事前取得の性質検査 — **押す前にもう取ってあるか**。
 *
 * 押したあとの速さは測らない (dev サーバー相手では意味を持たない)。
 * 「切替先の URL が、押す前の `performance.getEntriesByType("resource")` に
 * 既に載っているか」だけを見る。載っていれば押した瞬間に出る。
 */
async function assertAssetPrefetched(page: Page, row: Interaction, scenario: (typeof SCENARIOS)[string]) {
  await scenario.arrive(page);

  /* 先読みは 1 枚目が落ち着いてから (`requestIdleCallback`) 動くので、**終わるのを待つ**。
     待つのであって、速さは測らない (何 ms で終わったかは一切見ない)。

     ## 何を待つかを間違えると flaky になる
     初版は「`/_next/image` の取得が 2 件を超えたら先読み完了」と見なしていた。
     これは**先読みとは無関係の枚数でも満たされる** — メイン画像 1 枚と
     サムネイル 1 枚で既に 2 件になる。結果、先読みが終わる前に先へ進み、
     CI で 2 回落ちて retry #2 でだけ通った (run 33058567506)。
     `--retries=2` に隠された緑は、この spec が無くそうとしているものそのもの。

     いま待つのは **先読み用の隠しコンテナの `<img>` が全部 `complete` になること**。
     これは「先読みが終わった」の直接の表現で、枚数にも速さにも依存しない。 */
  /* 待つのは **これから押す 1 枚だけ**。
     先読みコンテナは `images` と同じ順で並ぶので、押す先 (nth(1)) がそれ。

     全 3 枚を待っていたら CI で 3/3 落ちた (run 33066349720 / `Received: 0` =
     コンテナは出ているが取得が終わらない)。`next dev` の `/_next/image` は
     要求のたびに変換するので、3 枚ぶんの変換を待つと 30 秒に収まらないことがある。
     しかも**後段の assert が見るのは押した 1 枚だけ**なので、3 枚待つのは
     検査の中身を増やさずに落ちる確率だけ上げていた。 */
  const PREFETCH_CONTAINER = ".sr-only[aria-hidden] img";
  const TARGET_INDEX = 1;

  await expect
    .poll(
      async () =>
        page.evaluate(
          ([selector, index]) => {
            const imgs = [...document.querySelectorAll<HTMLImageElement>(selector as string)];
            if (imgs.length === 0) return -1;
            const target = imgs[index as number];
            if (!target) return -2;
            return target.complete && target.currentSrc !== "" ? 1 : 0;
          },
          [PREFETCH_CONTAINER, TARGET_INDEX] as const,
        ),
      {
        message:
          `${row.id}: 押される前に切替先の画像を取り終えていない。` +
          "サムネイルを押してから取りにいくと、未取得の 1 枚を取り終わるまで " +
          "見た目は旧画像のまま (網羅表 G1 / 本番実測 705〜1,865ms)。" +
          "(-1 = 先読みのコンテナ自体が描かれていない / -2 = 切替先の枚数が足りない / " +
          "0 = まだ取得中)",
        timeout: 30_000,
      },
    )
    .toBe(1);

  const beforeClick = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      // 画像は Vercel の変換 (`/_next/image`) を通さず、CDN 直 (Shopify `?width=`) か
      // ローカル静的ファイル (見本カタログの `/hero-*` 画像等) をそのまま取る
      // (`lib/image-loader.ts`)。先読み一覧も同じ土俵で拾う。
      .filter((e) =>
        /\/_next\/image|cdn\.shopify\.com|\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(e.name),
      )
      .map((e) => e.name),
  );

  await scenario.act(page);

  /* **`src` ではなく `currentSrc` を見る。**
     `next/image` は `src` に候補の最大 (w=3840) を置き、実際に取る 1 本は
     `srcset` + `sizes` からブラウザが選ぶ。`src` を比べると「先読みした w=640」と
     「属性上の w=3840」が食い違い、**先読みが効いていても落ちる**。
     `currentSrc` はブラウザが実際に取った URL なので、先読み一覧と同じ土俵になる。 */
  const shown = await page
    .locator("button.cursor-zoom-in img")
    .first()
    .evaluate((el) => (el as HTMLImageElement).currentSrc);

  expect(shown, `${row.id}: メイン画像が読み込まれていない`).toBeTruthy();

  /* `toContain` で比べるのは、外れたときに**取ってあった一覧そのもの**が
     出力に出るから。真偽値の assert だと「false でした」しか残らず、
     先読みが何を取っていたのかを毎回手で調べ直すことになる。 */
  expect(
    beforeClick.map((url) => decodeURIComponent(url)),
    `${row.id}: 押したあとに表示された画像が、押す前の取得一覧に無い。` +
      "先読みが効いていない (網羅表 G1 の再発)。",
  ).toContain(decodeURIComponent(shown ?? ""));
}

/**
 * 遷移の性質検査 — **着地を待たずに「押された」が見えるか**。
 *
 * 遷移そのものを速くはできない (取り直す件数はサーバが決める)。できるのは
 * **押された瞬間に印を出すこと**で、それが出ないと「押しても何も起きない」に
 * 見えて二度押し・離脱になる (網羅表 G6 / 本番で 1 ドットも変わらなかった)。
 *
 * だから遷移の往復を `page.route()` で保留したまま押し、`observe` が
 * **着地前に**現れることを見る。時間は測らない。
 */
async function assertRouterNavFeedback(
  page: Page,
  row: Interaction,
  scenario: (typeof SCENARIOS)[string],
) {
  await scenario.arrive(page);

  const observe = row.observe ?? [];
  expect(observe.length, `${row.id} は observe が空`).toBeGreaterThan(0);

  /* 遷移 (RSC の取得) を保留する。返さないので画面は着地しない。 */
  await page.route(scenario.blocks ?? "**/*", async () => {
    await new Promise(() => {});
  });

  await scenario.act(page);

  for (const selector of observe) {
    await expect(
      page.locator(selector).first(),
      `${row.id}: ${selector} が出ない。遷移の着地を待つあいだ画面が変わらないので、` +
        "押しても何も起きていないように見える (網羅表 G6 の再発)。",
    ).toBeVisible({ timeout: 10_000 });
  }
}

/**
 * 取り消しの利かない操作の性質検査 — **着地を待たずに「受け付けた」が見えるか**。
 *
 * `pessimistic-*` は結果を先に描かない。描けないからではなく、外れたときに
 * 「成立したように見えたものが無かったことになる」ほうが遅さより重い裏切りだから
 * (`lib/interaction/mutation-classes.ts`)。そのぶん **進行の印だけは往復を待たずに
 * 出す**のが約束なので、往復を保留したまま押して印が出るかを見る。
 *
 * 見ている性質は `router-nav` と同じ (着地前に画面が変わるか) だが、落ちたときに
 * 直す場所が違う (あちらは遷移の印、こちらは送信の印) ので関数を分けてある。
 */
async function assertPendingFeedback(
  page: Page,
  row: Interaction,
  scenario: (typeof SCENARIOS)[string],
) {
  await scenario.arrive(page);

  const observe = row.observe ?? [];
  expect(observe.length, `${row.id} は observe が空`).toBeGreaterThan(0);

  /* 送信の往復を**永久に保留**する (中断ではない — 返事が来ないあいだを見たい)。 */
  await page.route(scenario.blocks ?? "**/*", async (route, request) => {
    if (request.method() === "GET") return route.continue();
    await new Promise(() => {});
  });

  await scenario.act(page);

  for (const selector of observe) {
    await expect(
      page.locator(selector).first(),
      `${row.id}: ${selector} が出ない。送信の返事を待つあいだ画面が変わらないので、` +
        "押しても何も起きていないように見える (二度押し・離脱の原因)。",
    ).toBeVisible({ timeout: 10_000 });
  }
}

/* -------------------------------------------------------------------------- */

test.describe("憲章 R9 — 台帳が宣言した応答が、実際にその性質を持つ", () => {
  for (const row of DECLARED) {
    const scenario = SCENARIOS[row.id];

    /* 台帳に宣言があるのに手順が無い = 宣言だけして検査していない。
       `__tests__/interaction-inventory.test.ts` が先に落とすが、
       ここでも落としておく (spec 単体で走らせたときに黙って通らないため)。 */
    if (!scenario) {
      test(`${row.id} — 手順が未登録`, () => {
        throw new Error(
          `台帳が ${row.id} に response="${row.response}" を宣言しているのに、` +
            "e2e/interaction-response.spec.ts の SCENARIOS に操作手順がありません。" +
            "宣言だけして検査しないと、台帳は「守っているつもり」の表になります。",
        );
      });
      continue;
    }

    test(`${row.id} (${row.response})`, async ({ page }) => {
      /* **この skip は既知で、Boss が暫定許容している** (2026-08-27 の敵対 QA 判定)。
         CI に Shopify の資格情報が無いため、カート書き込みを要する 3 件
         (数量 / 削除 / 追加) は CI では走らない = G2 の回帰ガードは資格情報の
         ある環境でしか働かない。これは検査の弱点として**報告済み**であり、
         隠していない: skip は `pnpm report:e2e-skips` が CI サマリに理由付きで
         出す (ci.yml の「Report skipped tests (no-op green visibility)」)。
         恒久解 (CI への資格情報投入 or 見本カートでの代替) は別件。 */
      test.skip(
        Boolean(scenario.requiresMemberSession) && !MEMBER_SESSION_CONFIGURED,
        MEMBER_SESSION_SKIP_REASON,
      );

      test.skip(
        Boolean(scenario.requiresCart) && !STOREFRONT_CONFIGURED,
        "Shopify Storefront の資格情報 (SHOPIFY_STORE_DOMAIN / " +
          "SHOPIFY_STOREFRONT_ACCESS_TOKEN) が未設定 — カートへの書き込みは実ストアに " +
          "しか無く、見本カタログでは楽観更新の対象そのものが作れない " +
          "(既存の Checkout happy path と同じ理由 / Boss 暫定許容 2026-08-27)",
      );

      switch (row.response) {
        case "optimistic":
        case "sync-dom":
          await assertOptimistic(page, row, scenario);
          break;
        case "asset-load":
          await assertAssetPrefetched(page, row, scenario);
          break;
        case "router-nav":
          await assertRouterNavFeedback(page, row, scenario);
          break;
        case "pessimistic-commit":
        case "pessimistic-form":
          await assertPendingFeedback(page, row, scenario);
          break;
        default:
          throw new Error(
            `${row.id}: response="${row.response}" の検査方法がこの spec にありません。` +
              "台帳に新しい応答の種類を足したら、ここに判定も足してください。",
          );
      }
    });
  }
});
