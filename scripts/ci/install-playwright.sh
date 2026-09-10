#!/usr/bin/env bash
#
# CI 用 Playwright インストーラ (apt 無限ストール対策)
#
# なぜ必要か
# ----------
# `playwright install --with-deps chromium` は内部で apt-get update /
# apt-get install を呼ぶ。GitHub Actions runner の apt ミラーが不調だと
# apt がここで**無制限に**ストールし、job が timeout-minutes の上限まで
# ハングしてキャンセルされる。
#
#   実例: run 32275002652 (main dc8fa0f)。attempt 1 / 2 とも
#   "Install Playwright browsers" で 20 分上限に到達して cancelled。
#   ログの最後は `Get:5 https://archive.ubuntu.com/ubuntu noble-security
#   InRelease [126 kB]` (16:40:56) で、そこから 17:00:10 のキャンセルまで
#   一行も出ていない。テストは 1 件も起動しておらず、後続の
#   deploy-production が skipped で止まった。
#   直前の成功 run 32133923769 では同じステップが 23 秒で終わっている
#   (11:54:54 -> 11:55:17) ので、コード側の変更ではなくミラー障害。
#
# apt 自身の Acquire::*::Timeout は「無通信」にしか効かず、細くバイトが
# 流れ続けるミラーには効かない。よって外側から必ず打ち切る必要がある。
#
# 方針
# ----
#   1. システム依存 (apt) とブラウザ本体 (ダウンロード) を分離する。
#      apt を触るのは install-deps だけなので、障害を局所化できる。
#   2. どちらも hard timeout + リトライで囲む。無限待ちを作らない。
#   3. 失敗は失敗として非ゼロ終了する (握りつぶさない)。
#      = 検査を弱めるのではなく「20 分ハング」を「数分で明示的に失敗」に
#      変えるだけ。E2E の合否判定そのものには一切手を入れていない。
#
# 使い方: scripts/ci/install-playwright.sh [browser]   (既定: chromium)
#
set -euo pipefail

BROWSER="${1:-chromium}"

# 健全な run では deps ~10s / download ~15s で終わる。下記は十分な余裕を
# 見た上限で、越えたらミラー障害とみなして張り直す。
DEPS_TIMEOUT="${PW_DEPS_TIMEOUT:-90}"
DOWNLOAD_TIMEOUT="${PW_DOWNLOAD_TIMEOUT:-180}"
ATTEMPTS="${PW_INSTALL_ATTEMPTS:-2}"

log() { printf '[install-playwright] %s\n' "$*"; }

# `timeout` が無い環境 (macOS 素の状態) でもスクリプトが動くようにする。
# CI は Linux なので実際には常に coreutils の timeout が使われる。
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

run_with_retry() {
  local label="$1"
  local limit="$2"
  shift 2

  local attempt=1
  local code
  while :; do
    log "${label}: attempt ${attempt}/${ATTEMPTS} (hard timeout ${limit}s)"
    code=0
    if [ -n "${TIMEOUT_BIN}" ]; then
      "${TIMEOUT_BIN}" --signal=TERM --kill-after=30s "${limit}" "$@" || code=$?
    else
      log "${label}: WARNING - no timeout(1) available, running unbounded"
      "$@" || code=$?
    fi

    if [ "${code}" -eq 0 ]; then
      log "${label}: ok"
      return 0
    fi
    if [ "${code}" -eq 124 ] || [ "${code}" -eq 137 ]; then
      log "${label}: TIMED OUT after ${limit}s (mirror/network stall)"
    else
      log "${label}: failed with exit ${code}"
    fi

    if [ "${attempt}" -ge "${ATTEMPTS}" ]; then
      log "${label}: giving up after ${ATTEMPTS} attempt(s)"
      return "${code}"
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
}

# apt にもネットワーク上限とリトライを入れておく。timeout(1) が最後の砦だが、
# これがあると「1 ミラーだけ死んでいる」ケースは apt 自身が数十秒で見切って
# 別ミラーに移れる。
harden_apt() {
  command -v apt-get >/dev/null 2>&1 || return 0
  local conf=/etc/apt/apt.conf.d/99-ci-network-timeouts
  local body='Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
Acquire::ftp::Timeout "30";
'
  if [ "$(id -u)" -eq 0 ]; then
    printf '%s' "${body}" >"${conf}"
  elif command -v sudo >/dev/null 2>&1; then
    printf '%s' "${body}" | sudo tee "${conf}" >/dev/null
  else
    log "apt hardening skipped (no root, no sudo)"
    return 0
  fi
  log "apt hardening written to ${conf}"
}

main() {
  if command -v apt-get >/dev/null 2>&1; then
    harden_apt
    # `install-deps` が apt を触る唯一のステップ。ここだけを短く縛る。
    run_with_retry "install-deps" "${DEPS_TIMEOUT}" \
      pnpm exec playwright install-deps "${BROWSER}"
  else
    log "apt-get not found (non-Debian host) - skipping system deps"
  fi

  # ブラウザ本体の取得。apt を経由しないので独立してリトライできる。
  run_with_retry "install-browser" "${DOWNLOAD_TIMEOUT}" \
    pnpm exec playwright install "${BROWSER}"

  log "done (${BROWSER})"
}

main "$@"
