#!/usr/bin/env bash
# install-hooks.sh --- git hook を設置する。package.json の prepare から呼ばれるので、
# pnpm install した全員に自動で効く (各自が手で有効化する運用にしない)。
#
# 設置するもの:
#   1. pre-commit フレームワークの hook (pre-commit / pre-push の 2 stage)
#   2. .git/hooks/pre-push.legacy = main への直接 push を止める本命のガード
#      pre-commit は自身の判定に入る前に legacy hook を無条件で呼ぶので、
#      pre-commit 側のスキップ経路 (docs/ops/main-guard.md 参照) に穴を空けられない。
#
# worktree について:
#   hook は共通の git ディレクトリ (.git/hooks) に置かれ、git は全 worktree で共有する。
#   よって 1 回入れればこのリポの全 worktree に効く。--git-common-dir を使うのは、
#   worktree の中から実行されたときに worktree 専用ディレクトリへ書かないため。

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
case "$COMMON_GIT_DIR" in
  /*) ;;
  *) COMMON_GIT_DIR="$REPO_ROOT/$COMMON_GIT_DIR" ;;
esac
HOOK_DIR="$COMMON_GIT_DIR/hooks"

if ! command -v pre-commit >/dev/null 2>&1; then
  echo "[install-hooks] pre-commit が見つかりません。main-guard が効きません。" >&2
  echo "[install-hooks] 'brew install pre-commit' を実行してから 'pnpm install' し直してください。" >&2
  exit 0 # 依存インストール自体は失敗させない (警告に留める)
fi

pre-commit install --hook-type pre-commit --hook-type pre-push

mkdir -p "$HOOK_DIR"
cat >"$HOOK_DIR/pre-push.legacy" <<'SHIM'
#!/usr/bin/env bash
# 自動生成 (scripts/git-guard/install-hooks.sh)。直接編集しないこと。
# main への直接 push を止める。実体はリポジトリ内の追跡ファイル。
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
guard="$root/scripts/git-guard/pre-push-guard.sh"
if [ ! -x "$guard" ]; then
  echo "[main-guard] 拒否: $guard が見つからないか実行できません (fail-closed)。" >&2
  exit 1
fi
exec "$guard" "$@"
SHIM
chmod +x "$HOOK_DIR/pre-push.legacy"

echo "[install-hooks] hook を設置しました: $HOOK_DIR (この repo の全 worktree に効きます)"
