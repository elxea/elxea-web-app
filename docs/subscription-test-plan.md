# 定期購買管理 実データテスト計画

## 対象 API
Shopify Customer Account API (2025-04)
- エンドポイント: `https://shopify.com/53242265758/account/customer/api/2025-04/graphql`

## 前提条件
- Mikawaya 経由で作成済みの定期購買契約が存在すること
- テスト用に Customer Account API の OAuth2 フローでログインしてアクセストークンを取得すること
- `lib/shopify/customer.ts` の mutation 関数を直接使用

## テストシナリオ

### T1: サブスク一覧取得
```
GET subscriptions (Customer Account API)
期待値: Mikawaya で作成済みの契約 ID が返ること
```

### T2: Pause（一時停止）
```
pauseSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "PAUSED" になること
```

### T3: Resume（再開）
```
activateSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "ACTIVE" になること
```

### T4: Skip（次回スキップ）
```
skipNextBillingCycle(accessToken, contractId, 0)
期待値: { success: true }
確認: 次回請求日が1サイクル分スキップされること
```

### T5: Cancel（解約）
⚠️ 本番データでは実行しないこと。テスト専用契約で実施。
```
cancelSubscription(accessToken, contractId)
期待値: { success: true }
確認: Shopify Admin でステータスが "CANCELLED" になること
```

## テスト実行方法

1. Next.js 開発サーバー起動: `pnpm dev`
2. http://localhost:3000/account/subscriptions にアクセス
3. Shopify Customer Account でログイン
4. 各ボタン（停止/再開/スキップ）を操作
5. Shopify Admin で状態変化を確認

## Admin API テスト（別途）

Admin API トークンのスコープ追加後:
```bash
curl -X POST "https://elxea.myshopify.com/admin/api/2025-04/graphql.json" \
  -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_ACCESS_TOKEN" \
  -d '{"query":"{ subscriptionContracts(first: 5) { edges { node { id status } } } }"}'
```

## 注意事項
- Mikawaya で作成した契約は Customer Account API からアクセス可能（同一 Shopify ストアのため）
- 本番環境での Cancel テストは絶対に行わないこと
- Admin API は `read_own_subscription_contracts` スコープ追加後に使用可能
