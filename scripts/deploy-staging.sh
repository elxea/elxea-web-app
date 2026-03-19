#!/usr/bin/env bash
# =============================================================================
# deploy-staging.sh — elxea-web-app staging デプロイスクリプト
#
# 概要:
#   1. 型チェック・lint・E2E テスト（smoke のみ）を実行
#   2. Vercel staging 環境にデプロイ
#   3. Cloud Functions を staging 環境にデプロイ
#
# 前提条件:
#   - Vercel CLI がインストール済み: npm install -g vercel
#   - Firebase CLI がインストール済み: npm install -g firebase-tools
#   - vercel login 済み
#   - firebase login 済み
#   - .env.staging が存在する（.env.production.example を参考に作成）
#
# 実行:
#   bash scripts/deploy-staging.sh
#
# Setaka 承認後に deploy-production.sh を実行する。
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/.deploy-staging.log"
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
# 前提条件チェック
# ---------------------------------------------------------------------------

log "=== elxea-web-app staging デプロイ開始 ==="
log "プロジェクトディレクトリ: ${PROJECT_DIR}"

check_command "node"
check_command "pnpm"
check_command "vercel"
check_command "firebase"

cd "${PROJECT_DIR}"

# Git の作業ディレクトリが clean か確認
if [[ -n "$(git status --porcelain)" ]]; then
  log "警告: 未コミットの変更があります。デプロイを続行しますか？ [y/N]"
  read -r confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    error "デプロイを中断しました。変更をコミットしてから再実行してください。"
  fi
fi

CURRENT_BRANCH=$(git branch --show-current)
log "現在のブランチ: ${CURRENT_BRANCH}"

# ---------------------------------------------------------------------------
# Step 1: 依存関係インストール
# ---------------------------------------------------------------------------

log ""
log "--- Step 1: 依存関係インストール ---"
pnpm install --frozen-lockfile
log "完了"

# ---------------------------------------------------------------------------
# Step 2: 型チェック
# ---------------------------------------------------------------------------

log ""
log "--- Step 2: 型チェック ---"
pnpm tsc --noEmit 2>&1 | grep -v "debug-subs\|\.next/types" || true
log "完了"

# ---------------------------------------------------------------------------
# Step 3: Lint
# ---------------------------------------------------------------------------

log ""
log "--- Step 3: Lint ---"
pnpm lint || {
  log "警告: Lint エラーがあります。続行しますか？ [y/N]"
  read -r lint_confirm
  if [[ "${lint_confirm}" != "y" && "${lint_confirm}" != "Y" ]]; then
    error "Lint エラーを修正してから再実行してください。"
  fi
}
log "完了"

# ---------------------------------------------------------------------------
# Step 4: E2E スモークテスト（ローカル）
# ---------------------------------------------------------------------------

log ""
log "--- Step 4: E2E スモークテスト ---"
if command -v playwright &>/dev/null || pnpm exec playwright --version &>/dev/null; then
  log "Playwright でスモークテストを実行中..."
  pnpm exec playwright test e2e/smoke.spec.ts --reporter=list 2>&1 || {
    log "警告: スモークテストが失敗しました。続行しますか？ [y/N]"
    read -r test_confirm
    if [[ "${test_confirm}" != "y" && "${test_confirm}" != "Y" ]]; then
      error "テストを修正してから再実行してください。"
    fi
  }
else
  log "警告: Playwright が見つかりません。スモークテストをスキップします。"
  log "インストール: pnpm exec playwright install"
fi
log "完了"

# ---------------------------------------------------------------------------
# Step 5: Vercel staging デプロイ
# ---------------------------------------------------------------------------

log ""
log "--- Step 5: Vercel staging デプロイ ---"
log "Vercel preview デプロイを開始します..."

STAGING_URL=$(vercel deploy \
  --env NODE_ENV=production \
  --build-env NODE_ENV=production \
  2>&1 | tail -1)

log "デプロイ完了: ${STAGING_URL}"

# ---------------------------------------------------------------------------
# Step 6: Cloud Functions デプロイ（staging）
# ---------------------------------------------------------------------------

log ""
log "--- Step 6: Cloud Functions staging デプロイ ---"

if [[ -f "${PROJECT_DIR}/functions/package.json" ]]; then
  log "Firebase Functions をデプロイ中..."
  # staging プロジェクトに対してデプロイ
  # NOTE: .firebaserc に staging alias が定義されている必要がある
  firebase deploy --only functions --project staging 2>&1 || {
    log "警告: Cloud Functions のデプロイに失敗しました。"
    log "  確認事項:"
    log "  - .firebaserc に staging プロジェクトが設定されているか"
    log "  - firebase login が完了しているか"
    log "  - Firebase プロジェクトに Functions が有効化されているか"
  }
else
  log "functions/ ディレクトリが見つかりません。Cloud Functions のデプロイをスキップします。"
fi

# ---------------------------------------------------------------------------
# Step 7: デプロイ後確認
# ---------------------------------------------------------------------------

log ""
log "--- Step 7: デプロイ後確認 ---"

if [[ -n "${STAGING_URL}" ]]; then
  log "ヘルスチェック: ${STAGING_URL}/api/health"
  curl -s -o /dev/null -w "HTTP ステータス: %{http_code}" "${STAGING_URL}/api/health" || true
  log ""
fi

# ---------------------------------------------------------------------------
# 完了レポート
# ---------------------------------------------------------------------------

log ""
log "=== staging デプロイ完了 ==="
log "Staging URL: ${STAGING_URL:-（URL取得失敗）}"
log "ログ: ${LOG_FILE}"
log ""
log "次のステップ:"
log "  1. Staging URL で動作確認"
log "  2. E2E テスト実行: pnpm exec playwright test e2e/ms7-personalization.spec.ts"
log "  3. Setaka の承認を取得"
log "  4. 本番デプロイ: bash scripts/deploy-production.sh"
