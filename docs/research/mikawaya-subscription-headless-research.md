# Mikawaya Subscription xヘッドレスNext.jsストアフロント 調査結果

> # 不採用 — 歴史的記録 (現行仕様ではない)
>
> **2026-08-10 Setaka確認により、Mikawaya (サードパーティ定期購買アプリ) は採用しない。**
> 定期便の課金・契約管理は**自前実装 (自前cron `/api/cron/billing`) に一本化**する。
> **互換併存は禁止** — アプリと自前cronを並走させる構成は取らない
> (同一ストアに二つの課金主体が並ぶと同一サイクルに二重課金が起きるため)。
>
> 本ファイルは「なぜこのアプリを評価し、なぜ採らなかったか」を残すための調査記録である。
> **設計判断の根拠として引用してはならない。** 本文中の「推奨」「対策案」「アクションプラン」は
> すべて失効している (§8参照)。
>
> - 現行の正本: `docs/subscription-test-plan.md` / `app/api/cron/billing/route.ts` / `lib/shopify/subscription-admin.ts`
> - 決定の記録: Decision Log「定期便の課金・契約管理は自前cronに一本化する (Mikawaya不使用)」(2026-08-10)

**調査日**: 2026-03-08
**調査者**: Developer Agent
**ステータス**: **不採用確定 (2026-08-10)** — 調査自体は2026-03-08に完了

---

## 結論（先に）

Mikawaya Subscription はヘッドレス Next.js ストアフロントと **原理的には統合可能** だが、公式にヘッドレス対応を謳っておらず、いくつかの課題がある。サブスクリプション商品の表示・カート追加・チェックアウトは **Shopify の Selling Plan API（Storefront API）** を通じて実現できる。ただし、Mikawaya 固有の機能（マイページ、BOX、CRM 連携等）はヘッドレス環境では制限される可能性が高い。

---

## 1. Mikawaya Subscription の概要

- **開発元**: Floor Standard (floor-s.co.jp)
- **累計流通額**: 100 億円突破
- **対応言語**: 日本語のみ（英語サポートなし）
- **料金プラン**:
  - Free: $0/月（テストモードのみ）
  - Light: $12/月 + 3% 手数料
  - Standard: $49/月 + 1% 手数料
  - Pro: $499/月 + 1% 手数料（カスタム開発、マイページ API 等）

---

## 2. Selling Plan API との関係

### 回答: はい、Mikawaya は Shopify の Selling Plan API を使用している

Shopify のサブスクリプションアーキテクチャは以下の 3 つの API で構成される:

| API | 役割 |
|-----|------|
| **Selling Plan API** | サブスクリプション商品の定義（請求頻度、割引ポリシー等） |
| **Subscription Contract API** | 顧客のサブスクリプション契約管理 |
| **Customer Payment Method API** | 保存された決済情報への読み取りアクセス |

**Shopify の責任範囲**:
- データの保存
- 決済処理（請求の実行）
- チェックアウト時にサブスクリプション契約を自動生成

**Mikawaya（アプリ）の責任範囲**:
- Selling Plan の作成・設定（Admin API 経由）
- 管理画面 UI の提供
- Webhook の処理
- 請求タイミングの自動化
- 顧客向けマイページの提供

Mikawaya は Admin API の `sellingPlanGroupCreate` ミューテーションを使って Selling Plan Group を作成し、商品に紐付ける。一度作成された Selling Plan は **Shopify のネイティブ機能として Storefront API からもアクセス可能** になる。

---

## 3. Storefront API でサブスクリプション商品にアクセスできるか

### 回答: はい、可能

Mikawaya が作成した Selling Plan は、Shopify の Storefront API 経由で取得できる。

### 必要なアクセススコープ
```
unauthenticated_read_selling_plans
```

### GraphQL クエリ例（商品の Selling Plan 取得）
```graphql
query getProductSellingPlans($handle: String!) {
  product(handle: $handle) {
    sellingPlanGroups(first: 10) {
      edges {
        node {
          name
          sellingPlans(first: 10) {
            edges {
              node {
                id
                name
                description
                recurringDeliveries
                options {
                  name
                  value
                }
                priceAdjustments {
                  adjustmentValue {
                    ... on SellingPlanPercentagePriceAdjustment {
                      adjustmentPercentage
                    }
                    ... on SellingPlanFixedAmountPriceAdjustment {
                      adjustmentAmount {
                        amount
                        currencyCode
                      }
                    }
                    ... on SellingPlanFixedPriceAdjustment {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    variants(first: 10) {
      edges {
        node {
          id
          title
          sellingPlanAllocations(first: 10) {
            edges {
              node {
                sellingPlan {
                  id
                  name
                }
                priceAdjustments {
                  price {
                    amount
                    currencyCode
                  }
                  compareAtPrice {
                    amount
                    currencyCode
                  }
                  perDeliveryPrice {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### カート作成（サブスクリプション付き）
```graphql
mutation cartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart {
      id
      checkoutUrl
      lines(first: 10) {
        edges {
          node {
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
              }
            }
            sellingPlanAllocation {
              sellingPlan {
                id
                name
              }
            }
          }
        }
      }
    }
  }
}
```

変数:
```json
{
  "input": {
    "lines": [
      {
        "merchandiseId": "gid://shopify/ProductVariant/XXXXX",
        "quantity": 1,
        "sellingPlanId": "gid://shopify/SellingPlan/XXXXX"
      }
    ]
  }
}
```

### 重要な制約
- サブスクリプション商品は **Cart API（`cartCreate` ミューテーション）** を使う必要がある（Checkout API は使えない）
- 既に elxea は Cart API ベースで実装済みなので、この制約は問題ない
- バリアントごとに最大 2 つの価格調整（priceAdjustments）をサポート

---

## 4. 商品ページに必要な変更

### 必要な実装
1. **Selling Plan の取得**: 商品クエリに `sellingPlanGroups` フィールドを追加
2. **購入オプション UI**: 「通常購入」と「定期購入」の切り替え UI
3. **Selling Plan セレクター**: 配送頻度等のオプション選択 UI
4. **価格表示の切り替え**: 選択した Selling Plan に応じた割引価格の表示
5. **カート追加ロジック**: `addToCart` に `sellingPlanId` パラメータを追加

### UI コンポーネント設計（概要）
```
[商品ページ]
├── 商品情報
├── バリアント選択
├── 購入オプション
│   ├── ○ 通常購入 ¥X,XXX
│   └── ○ 定期購入 ¥X,XXX（XX% OFF）
│       └── 配送頻度: [30日ごと ▼]
├── 数量
└── カートに追加
```

---

## 5. Mikawaya 独自の API について

### マイページ API
- Mikawaya は **マイページ API** を公開している
- これは「サブスクリプション管理マイページ」の UI カスタマイズ用
- 商品表示やストアフロント機能ではない
- Pro プラン（$499/月）で利用可能
- **公開ドキュメントは存在しない**（直接問い合わせが必要）

### API の対象範囲
| 機能 | API 提供元 | ヘッドレス対応 |
|------|-----------|--------------|
| サブスクリプション商品表示 | Shopify Storefront API | ○ 対応可 |
| カート追加（Selling Plan 付き） | Shopify Storefront API | ○ 対応可 |
| チェックアウト | Shopify Checkout | ○ 対応可（checkoutUrl にリダイレクト） |
| サブスクリプション管理マイページ | Mikawaya マイページ API | △ 要確認（Pro プラン） |
| BOX 機能 | Mikawaya 独自 | × 未確認 |
| CRM 連携（LINE 等） | Mikawaya 独自 | × Mikawaya 側で処理 |
| LTV 分析 | Mikawaya 管理画面 | - アプリ管理画面で利用 |

---

## 6. チェックアウトフロー

ヘッドレス環境でのサブスクリプション商品のチェックアウトフロー:

```
[Next.js ストアフロント]
  ↓ 商品ページで Selling Plan 選択
  ↓ cartCreate mutation (merchandiseId + sellingPlanId)
  ↓ Shopify Cart 作成
  ↓ checkoutUrl 取得
  ↓ Shopify Checkout にリダイレクト
[Shopify Checkout]
  ↓ 決済処理
  ↓ Subscription Contract自動生成
  ↓ MikawayaがWebhookでContractを検知
[Mikawaya]
  ↓ 以降の請求管理をMikawayaが自動化
```

このフローは既存の elxea のチェックアウトフロー（Cart API → checkoutUrl リダイレクト）と **完全に互換** がある。

> **採用しなかった (2026-08-10)**: 上図の最後の 2 段 (Mikawaya が Contract を検知し、以降の請求管理を
> 自動化する) が現行構成には存在しない。Subscription Contract の自動生成までは Shopify ネイティブなので
> 同じだが、**以降の請求は自前 cron `/api/cron/billing` が起こす**。この点だけが現行と異なる。

---

## 7. 懸念事項・リスク

### 高リスク
1. **マイページ問題**: Mikawaya のサブスクリプション管理マイページ（配送頻度変更、スキップ、解約等）は Shopify テーマに依存した Liquid ベースの実装。ヘッドレス環境では動作しない可能性がある。
   - **対策案 A**: マイページ API（Pro プラン $499/月）で独自実装
   - **対策案 B**: マイページのみ Shopify のドメインにリダイレクト
   - **対策案 C**: Shopify Customer Account API + Subscription Contract API で自前実装（Mikawaya に依存しない）

2. **テーマコードインストール**: Mikawaya は Shopify テーマにコードスニペットの追加を要求する。ヘッドレスでは Shopify テーマを使用しないため、この設置ステップを回避する方法を確認する必要がある。

### 中リスク
3. **Customer Account の制約**: サブスクリプション利用時は「従来のカスタマーアカウント（レガシー）」のみ対応で、新しいアカウントタイプは使えない。現在 elxea は Customer Account API を使用しているため、互換性を確認する必要がある。

4. **Mikawaya サポートとの連携**: 英語サポートなし、ヘッドレスに関する公式ドキュメントなし。日本語での直接問い合わせが必須。

### 低リスク
5. **Selling Plan のアクセススコープ**: Headless チャネルまたはカスタムアプリに `unauthenticated_read_selling_plans` スコープを追加する必要がある（設定変更のみ）。

---

## 8. 推奨アクションプラン → **失効 (2026-08-10)**

**この節にあった行動計画は実行されない。** Mikawayaは不採用となったため、
「Mikawayaサポートへの問い合わせ」「マイページAPI (Proプラン) の採用検討」を含む
アプリ前提の項目はすべて破棄する。

採用した路線は §7の高リスク項目1で挙げていた **対策案C
「Shopify Customer Account API + Subscription Contract APIで自前実装」** であり、
これは既に実装済みである (`lib/shopify/subscription-admin.ts` /
`lib/shopify/subscription-actions.ts` / `app/api/cron/billing/route.ts`)。

なお、本節に含まれていた項目のうち **Shopifyネイティブ機構に属するもの**
(`unauthenticated_read_selling_plans` スコープ、商品クエリの `sellingPlanGroups`、
Selling Planの選択UI、`addToCart` の `sellingPlanId`) は、アプリの採否とは無関係に
必要な作業であり、自前実装の一部として実施済み。アプリ由来の要件ではない。

現行の作業計画は `docs/subscription-test-plan.md` を参照する。

---

## 9. 参考資料

### Shopify 公式
- [Manage subscription products on storefronts](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/subscriptions)
- [About selling plans](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans)
- [SellingPlan - Storefront API](https://shopify.dev/docs/api/storefront/latest/objects/SellingPlan)
- [Build a selling plan](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans/build-a-selling-plan)
- [About subscriptions](https://shopify.dev/docs/apps/build/purchase-options/subscriptions)

### Mikawaya
- [Mikawaya Subscription - Shopify App Store](https://apps.shopify.com/mikawaya)
- [Mikawaya ヘルプページ](https://mikawayahelp.oopy.io)
- [マイページカスタマイズ](https://mikawayahelp.oopy.io/baf1f988-6c44-4f25-817e-f2027ac756eb)
- [Pro プラン](https://mikawayahelp.oopy.io/7d6caeed-12cd-4f33-b61f-8ba3436f1bf3)

### 技術参考
- [Subscriptions & Selling Plans with Shopify Storefront API](https://jackwhiting.co.uk/posts/subcriptions-and-selling-plans-with-shopify-storefront/)
- [Shopify Subscription APIs を掘り下げて分かったこと](https://zenn.dev/kei178/articles/aadc0b3b6ea64e)
- [Headless Checkout for Subscriptions - Shopify Community](https://community.shopify.com/c/subscriptions/headless-checkout-for-subscriptions/td-p/1331214)
