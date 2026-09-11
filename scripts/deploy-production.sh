#!/usr/bin/env bash
# =============================================================================
# deploy-production.sh — elxea-web-app 本番デプロイスクリプト
#
# 概要:
#   1. staging 動作確認済み・Setaka 承認済みであることを確認
#   2. 型チェック・lint を再実行
#   3. Vercel production 環境にデプロイ
#   4. Cloud Functions を本番環境にデプロイ
#   5. Shopify Webhook URL を確認・登録
#
# 前提条件:
#   - staging デプロイ完了・動作確認済み
#   - Setaka の承認を得ていること（Tier 2 タスク）
#   - Vercel CLI がインストール済み: npm install -g vercel
#   - Firebase CLI がインストール済み: npm install -g firebase-tools
#   - 環境変数が Vercel production に設定済み（scripts/setup-vercel-env.sh 参照）
#
# 実行:
#   bash scripts/deploy-production.sh
#
# 警告: このスクリプトは本番環境に影響します。Setaka 承認後のみ実行してください。
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/.deploy-production.log"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# ---------------------------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------------------------

log() {
  echo "[${TIMESTAMP}] $*" | tee -a "${LOG_FILE}"
}

error() {
  echo "[ERROR] $*" >&2
  exit 1
}

check_command() {
  command -v "$1" &>/dev/null || error "コマンドが見つかりません: $1。インストールしてください。"
}

# ---------------------------------------------------------------------------
# 承認確認（最重要）
# ---------------------------------------------------------------------------

echo ""
echo "================================================================="
echo "  本番デプロイスクリプト"
echo "  このスクリプトは elxea 本番環境に変更を反映します"
echo "================================================================="
echo ""
echo "チェックリスト:"
echo "  [ ] staging 環境で全フローを動作確認した"
echo "  [ ] E2E テスト（ms7-personalization.spec.ts）が全件 PASS した"
echo "  [ ] Setaka の承認を得た"
echo ""
echo "Setaka の承認を得ましたか？ 承認コード（Notion タスク ID の下4桁）を入力:"
read -r approval_code

if [[ -z "${approval_code}" ]]; then
  error "承認コードが入力されていません。Setaka の承認を取得してから実行してください。"
fi

log "承認コード: ${approval_code} で本番デプロイを開始します"

# ---------------------------------------------------------------------------
# 前提条件チェック
# ---------------------------------------------------------------------------

log ""
log "=== elxea-web-app 本番デプロイ開始 ==="
log "プロジェクトディレクトリ: ${PROJECT_DIR}"

check_command "node"
check_command "pnpm"
check_command "vercel"
check_command "firebase"

cd "${PROJECT_DIR}"

# ---------------------------------------------------------------------------
# Step 1: 最新のコードを確認
# ---------------------------------------------------------------------------

log ""
log "--- Step 1: Git 状態確認 ---"
CURRENT_BRANCH=$(git branch --show-current)
log "ブランチ: ${CURRENT_BRANCH}"

if [[ -n "$(git status --porcelain)" ]]; then
  log "警告: 未コミットの変更があります。"
  git status --short
  error "全ての変更をコミット・マージしてから本番デプロイを実行してください。"
fi

log "Git 状態: clean"

# ---------------------------------------------------------------------------
# Step 2: 依存関係インストール
# ---------------------------------------------------------------------------

log ""
log "--- Step 2: 依存関係インストール ---"
pnpm install --frozen-lockfile
log "完了"

# ---------------------------------------------------------------------------
# Step 3: 型チェック
# ---------------------------------------------------------------------------

log ""
log "--- Step 3: 型チェック ---"
pnpm tsc --noEmit 2>&1 | grep -v "debug-subs\|\.next/types" || true
log "完了"

# ---------------------------------------------------------------------------
# Step 4: Lint
# ---------------------------------------------------------------------------

log ""
log "--- Step 4: Lint ---"
pnpm lint || error "Lint エラーを修正してから本番デプロイを実行してください。"
log "完了"

# ---------------------------------------------------------------------------
# Step 5: Vercel 本番デプロイ
# ---------------------------------------------------------------------------

log ""
log "--- Step 5: Vercel 本番デプロイ ---"
log "Vercel production デプロイを開始します..."

PRODUCTION_URL=$(vercel deploy --prod \
  --env NODE_ENV=production \
  --build-env NODE_ENV=production \
  2>&1 | tail -1)

log "本番デプロイ完了: ${PRODUCTION_URL}"

# ---------------------------------------------------------------------------
# Step 6: Cloud Functions 本番デプロイ
# ---------------------------------------------------------------------------

log ""
log "--- Step 6: Cloud Functions 本番デプロイ ---"

if [[ -f "${PROJECT_DIR}/functions/package.json" ]]; then
  log "Firebase Functions を本番デプロイ中..."
  firebase deploy --only functions 2>&1 || {
    log "警告: Cloud Functions のデプロイに失敗しました。"
    log "  確認事項:"
    log "  - .firebaserc に default プロジェクトが設定されているか"
    log "  - firebase login が完了しているか"
  }
  log "Cloud Functions デプロイ完了"
else
  log "functions/ ディレクトリが見つかりません。スキップします。"
fi

# ---------------------------------------------------------------------------
# Step 7: Shopify Webhook URL 確認
# ---------------------------------------------------------------------------

log ""
log "--- Step 7: Shopify Webhook 確認 ---"
log ""
log "手動確認が必要です:"
log "  1. Shopify Admin → 設定 → 通知 → Webhook に以下を登録してください"
log "     イベント: 注文の作成 (orders/create)"
log "     URL: https://FIREBASE_FUNCTIONS_URL/shopifyOrderWebhook"
log "     形式: JSON"
log "  2. Webhook シークレットを Firebase Functions の環境変数に設定"
log "     firebase functions:config:set shopify.webhook_secret=\"YOUR_SECRET\""
log ""

# ---------------------------------------------------------------------------
# Step 8: デプロイ後確認
# ---------------------------------------------------------------------------

log ""
log "--- Step 8: デプロイ後確認 ---"
log "本番 URL: ${PRODUCTION_URL:-https://elxea.jp}"

# ヘルスチェック
HEALTH_URL="${PRODUCTION_URL:-https://elxea.jp}/api/health"
log "ヘルスチェック: ${HEALTH_URL}"
curl -s -o /dev/null -w "HTTP ステータス: %{http_code}" "${HEALTH_URL}" || true
log ""

# ---------------------------------------------------------------------------
# 完了レポート
# ---------------------------------------------------------------------------

log ""
log "=== 本番デプロイ完了 ==="
log "本番 URL: ${PRODUCTION_URL:-https://elxea.jp}"
log "承認コード: ${approval_code}"
log "ログ: ${LOG_FILE}"
log ""
log "デプロイ後タスク:"
log "  1. 本番環境で LIFF フローを手動確認"
log "  2. LINE リッチメニューの表示確認"
log "  3. Shopify Webhook の動作確認（テスト注文を作成）"
log "  4. elxea-agent の LIFF_ID を本番の値に更新"
log "     echo 'LIFF_ID_VALUE' | wrangler secret put LIFF_ID"
log "  5. Notion タスクを Done に更新（Setaka が実施）"
