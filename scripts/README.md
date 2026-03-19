# elxea-web-app scripts

## デプロイ手順（MS7）

### 前提条件

```bash
# Vercel CLI
npm install -g vercel
vercel login

# Firebase CLI
npm install -g firebase-tools
firebase login

# Playwright ブラウザ
pnpm exec playwright install chromium
```

### 環境変数の設定

`.env.production.example` を参考に、Vercel の環境変数を設定してください。

```bash
# 本番環境変数設定スクリプト（初回のみ）
bash scripts/setup-production.sh
```

---

## Staging デプロイ

```bash
bash scripts/deploy-staging.sh
```

**実行内容:**
1. 依存関係インストール（`pnpm install --frozen-lockfile`）
2. 型チェック（`tsc --noEmit`）
3. Lint（`next lint`）
4. E2E スモークテスト（`playwright test e2e/smoke.spec.ts`）
5. Vercel preview デプロイ
6. Cloud Functions staging デプロイ（`firebase deploy --only functions --project staging`）

**完了後:**
- Staging URL で動作確認
- E2E テスト実行（下記参照）
- Setaka に承認依頼

---

## 本番デプロイ（Setaka 承認必須）

```bash
bash scripts/deploy-production.sh
```

**注意:** Tier 2 タスク。Setaka の承認なしに実行しないこと。

**実行内容:**
1. 承認コード入力（Notion タスク ID 下4桁）
2. Git 状態確認（未コミット変更があると中断）
3. 依存関係インストール・型チェック・Lint
4. Vercel production デプロイ（`vercel deploy --prod`）
5. Cloud Functions 本番デプロイ
6. Shopify Webhook 登録手順の表示

---

## E2E テスト（MS7: パーソナライゼーション統合テスト）

```bash
# 全テスト実行
pnpm exec playwright test e2e/ms7-personalization.spec.ts

# デバッグ（ブラウザを表示して実行）
pnpm exec playwright test e2e/ms7-personalization.spec.ts --headed

# 特定テストケースのみ
pnpm exec playwright test e2e/ms7-personalization.spec.ts --grep "TC-1"

# HTMLレポートを開く
pnpm exec playwright show-report
```

### テスト環境変数（オプション）

```bash
# .env.test.local に設定
TEST_SHOPIFY_CUSTOMER_ID=<テスト用顧客ID>
TEST_SHOPIFY_SESSION_TOKEN=<テスト用セッショントークン>
AGENT_BASE_URL=https://elxea-agent-staging.YOUR_SUBDOMAIN.workers.dev
SHOPIFY_WEBHOOK_URL=https://FIREBASE_FUNCTIONS_URL/shopifyOrderWebhook
```

### テストケース一覧

| TC | テスト内容 | 自動化 | 備考 |
|----|-----------|--------|------|
| TC-1 | LIFF 紐付けフロー | 部分的 | LINE 外ブラウザでは LIFF SDK 初期化不可。エンドポイント存在確認のみ |
| TC-2 | 行動イベント蓄積 | はい | behavior API + 記事ページ |
| TC-3 | ペルソナ判定 | はい | persona API レスポンス形式確認 |
| TC-4 | コンテンツパーソナライズ | はい | 記事スコア順確認 |
| TC-5 | 商品レコメンド | はい | 商品レコメンド API |
| TC-6 | エージェント会話 | 部分的 | elxea-agent の staging URL 設定が必要 |
| TC-7 | Shopify 注文 Webhook | 部分的 | SHOPIFY_WEBHOOK_URL 設定が必要 |

### 手動テスト手順（LIFF フロー）

TC-1 の LIFF フローは LINE アプリ内でのみ完全テスト可能です。

1. LINE で elxea 公式アカウントを友達追加
2. リッチメニュー「お茶タイプ診断」をタップ
3. LIFF ページが開くことを確認
4. 「elxea アカウントでログイン」から Shopify 認証
5. テイスティングプロフィール画面が表示されることを確認
6. ペルソナ情報（初回は「まだプロフィールがありません」）が表示されることを確認

---

## その他のスクリプト

| スクリプト | 用途 |
|-----------|------|
| `backup-sanity.ts` | Sanity CMS データのバックアップ |
| `backup-shopify.ts` | Shopify データのバックアップ |
| `create-customer-metafields.ts` | Shopify Customer Metafield 定義の作成 |
| `seed-dummy-content.ts` | 開発用ダミーデータの投入 |
| `shopify-product-tags.ts` | Shopify 商品タグの一括更新 |
| `tag-articles.ts` | Sanity 記事の persona タグ付け |
| `sync-notion-to-sanity.ts` | Notion → Sanity データ同期 |
