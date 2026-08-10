# 定期便 実データテスト計画

> **課金の所有権 (2026-08-10 Setaka決定・確定事項)**
> 定期便の課金・契約管理は**自前実装に一本化**する。課金を起こす主体は本リポの
> 自前cron `/api/cron/billing` **だけ**であり、サードパーティの定期購買アプリは使わない。
> **互換併存は禁止** — 「アプリと自前cronの二重運用」「アプリ経由の契約と自前経由の契約の混在」は
> どちらも設計として認めない。同一ストアに二つの課金主体が並ぶと同一サイクルに二重課金が起きるため。
> 本計画のすべての手順は、この前提のうえに書かれている。
>
> 経緯: この方針自体は以前から決まっていたが、本ファイルを含む一部の文書に旧前提
> (サードパーティアプリが契約を作る) の記述が残っていた。2026-08-10に是正済み。
> 旧アプリの評価記録は `docs/research/mikawaya-subscription-headless-research.md`
> (不採用・歴史的記録) に隔離してある。

## 対象API

| 用途 | API | エンドポイント |
|---|---|---|
| 会員自身の操作 (一覧・停止・再開・スキップ・解約) | Shopify Customer Account API (2025-04) | `https://shopify.com/53242265758/account/customer/api/2025-04/graphql` |
| 運用側の操作 (契約一覧・課金試行・契約更新) | Shopify Admin API (2025-04) | `https://<store>.myshopify.com/admin/api/2025-04/graphql.json` |

## 前提条件

- **Admin APIに定期便スコープが付与されていること** (`read_own_subscription_contracts`)。
  未付与だと `getSubscriptionContracts` / `createBillingAttempt` / `updateSubscriptionContract` が
  すべて動かず、レーンAを1歩も開始できない。**これがクリティカルパス**。
  疎通確認: 下記「Admin API疎通確認」が200を返すこと。
- **テスト契約が自前の導線で作られていること**。サードパーティアプリは使わないので、
  契約は次のいずれかで用意する (どちらも本リポのコードだけで完結する):
  1. `createSellingPlanGroup` + `addProductsToSellingPlanGroup` (`lib/shopify/subscription-admin.ts`)
     でMONTH/1のSelling Plan商品をテストストアに作り、`/ja/subscription` の申込導線から購入する
  2. Shopify管理画面でSelling Planを持つ商品を用意し、テスト顧客でチェックアウトする
- テスト用にCustomer Account APIのOAuth2フローでログインしてアクセストークンを取得すること
- `lib/shopify/customer.ts` のmutation関数を直接使用
- **本番ストアでは実施しない**。テストストア (`roji-test2`) で行う

### Admin API疎通確認

```bash
curl -X POST "https://<store>.myshopify.com/admin/api/2025-04/graphql.json" \
  -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ subscriptionContracts(first: 5) { edges { node { id status nextBillingDate } } } }"}'
```

## レーンA: 2回目・3回目の課金を、日付を待たずに検証する

**原理**: `/api/cron/billing` の対象抽出は `status:ACTIVE` かつ `nextBillingDate <= 今` の
1本だけ (`app/api/cron/billing/route.ts`)。よってテスト契約の `nextBillingDate` を過去日に
書き換えれば、cronを手で叩くだけで次サイクルの課金が起きる。1ヶ月待つ必要がない。
書き換えは既存の `updateSubscriptionContract` (draft作成 → 更新 → commit) がそのまま使える。
**コード変更ゼロで回せるので、通常の検証はこのレーンを採る。**

| # | 手順 | 使うもの | 観測点 |
|---|---|---|---|
| A0 | Admin APIスコープ是正 | Shopifyアプリ設定 | 上記疎通確認が200 |
| A1 | テストストアにMONTH/1のSelling Plan商品を用意 | `createSellingPlanGroup` / `addProductsToSellingPlanGroup` | `/ja/subscription` にプランが出る (Selling Plan商品が無いとe2eが全skipになる) |
| A2 | テスト顧客で契約を1件作る (1回目の課金) | 申込導線 (`/ja/subscription`) | 契約がACTIVE、`nextBillingDate` が1ヶ月後 |
| A3 | 契約の `nextBillingDate` を昨日に書き換える | `updateSubscriptionContract(contractId, { nextBillingDate })` | 取得し直して過去日になっている |
| A4 | cronを手で叩く | `curl -H "Authorization: Bearer $CRON_SECRET" <base>/api/cron/billing` | `action` が `"billed"` (即時完了) または `"pending"` (Shopifyが受理・結果待ち) のどちらかで、`attemptNumber: 1`。`"failed"` が返ったら課金は起きていない |
| A5 | 2回目が成立したことの裏取り (4点) | Admin API + Shopify管理画面 + Firestore | (a) `subscriptionBillingAttempts` が1件増える (b) Shopifyに新規注文が立つ (c) 契約の `nextBillingDate` が1サイクル前進 (d) webhook `SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS` が `/api/subscription/webhook` に届きFirestoreに記録される |
| A6 | A3-A5をもう1回 (3回目) | 同上 | 冪等キーが `-attempt1` で同じでも `nextBillingDate` が変わるため別キーになり、二重課金にならないことを同時に確認できる |
| A7 | 失敗系: 決済が通らないテストカードで契約を作りA3-A4を3回繰り返す | 同上 | 1回目 `errorCode` あり → 24時間未経過なら `action: "waiting"` → 3回失敗で `action: "paused"` + 契約PAUSED + 督促メール (**実送信はSetaka承認後。それまでdry-run**) |

**注意 (A4のレスポンス解釈)**: `action` は成否をそのまま表す (2026-08-10是正)。
`errorCode` が返った試行は `"failed"` (初回) / `"retry_failed"` (リトライ)、
`errorCode` なしで `ready: false` (Shopifyが受理しただけで課金は非同期に進行中) は `"pending"`、
完了が確定したときだけ `"billed"` / `"retried"`。summaryの `billed` にも失敗・未確定は混ざらない。
`"pending"` の確定結果はwebhook (`subscription_billing_attempts/success|failure`) 側で観測する
(A5(d) と同じ経路)。

**注意 (対象契約の網羅)**: `getSubscriptionContracts` / `getBillingAttempts` は
connectionを最後のページまで走査する (2026-08-10是正。それまでは先頭20件のみで、
21件目以降のACTIVE契約が課金されないまま無音だった)。安全上限 (25件×100ページ) に
達した場合は打ち切らずエラーにするため、`checked` が実件数より少ないまま200が返ることはない。

**注意 (A7の24時間)**: リトライ間隔 `RETRY_INTERVAL_HOURS` (24h) は実時間を待たずに検証できない。
`countRecentFailures` / `isReadyForRetry` は純関数なので、待つのではなく **unit testで押さえるのが正しい**
(現在テスト0件・未整備)。

## 会員操作のテスト

### T1: 定期便一覧取得

```
GET subscriptions (Customer Account API)
期待値: 自前導線で作成したテスト契約の ID が返ること
```

### T2: Pause (一時停止)

```
pauseSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "PAUSED" になること
```

### T3: Resume (再開)

```
activateSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "ACTIVE" になること
```

### T4: Skip (次回スキップ)

```
skipNextBillingCycle(accessToken, contractId, 0)
期待値: { success: true }
確認: 次回請求日が 1 サイクル分スキップされること
```

サイクル番号はクライアント値を信用せず `upcomingBillingCycles(sortKey: CYCLE_INDEX)` から
サーバ側で解決している (`lib/shopify/customer.ts` の `resolveNextBillingCycleIndex`)。
検証でもこの関数の解決結果を観測点にする。

### T5: Cancel (解約)

⚠️ 本番データでは実行しないこと。テスト専用契約で実施。

```
cancelSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "CANCELLED" になること
```

## テスト実行方法

1. Next.js開発サーバー起動: `pnpm dev`
2. `http://localhost:3000/account/subscriptions` にアクセス
3. Shopify Customer Accountでログイン
4. 各ボタン (停止 / 再開 / スキップ) を操作
5. Shopify Adminで状態変化を確認
6. 課金サイクルの前進はレーンAの手順で別途確認する (UIでは起こせない)

## 既知の制約 (テスト設計に影響するもの)

- **\[解消済2026-08-10\] ページング欠落**。`getSubscriptionContracts` / `getBillingAttempts` は
  `pageInfo.hasNextPage` を辿って全ページを取得する (`lib/shopify/subscription-admin.ts`)。
  是正前は先頭20件のみで、**ACTIVE契約が21件以上になると21件目以降が永久に無音で未課金**だった。
  1ページ25件・上限100ページで、上限やcursor不整合に当たった場合は打ち切らず例外にする
  (部分結果を成功として返さない)。連続ページ取得でAdmin APIのcost制限に当たった場合のみ
  指数バックオフで再試行する。したがって「ACTIVE契約21件以上」の母数でもテストは成立する。
- `SUBSCRIPTION_CONTRACTS_QUERY` の各契約の `lines(first: 10)` は**未ページング**。
  11明細以上の契約では明細が切れる。課金の実行自体には影響しないが、督促メールの
  明細一覧が欠ける (テスト契約は10明細以内で組む)。
- `/api/cron/billing` 周辺のunit testは22件 (`__tests__/billing-cron-action.test.ts` 9件 /
  `__tests__/subscription-admin-pagination.test.ts` 13件)。`countRecentFailures` /
  `isReadyForRetry` の24時間境界と `action` 判定の全分岐をここで押さえている。
  e2e (`e2e/subscription-*.spec.ts`) はSelling Plan商品 / `CRON_SECRET` / Admin権限が
  無いと `test.skip` になるため、**緑でも何も検証していない状態になりうる**。skip件数を必ず確認する。

## 注意事項

- 本番環境でのCancelテストは絶対に行わないこと
- 督促メールの実送信はSetakaの承認が必要。承認前はdry-runで確認する
- Admin APIは `read_own_subscription_contracts` スコープ追加後に使用可能
