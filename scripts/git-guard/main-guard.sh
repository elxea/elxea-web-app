#!/usr/bin/env bash
# main-guard.sh --- main への直接 commit / 直接 push を手元で拒否する。
#
# なぜ手元でやるのか:
#   本リポは GitHub 無料プラン + private のため、branch protection / ruleset が
#   課金ゲートされていて張れない (REST classic / REST rulesets / GraphQL の 3 経路とも
#   403 "Upgrade to GitHub Pro or make this repository public")。
#   さらに DEPLOY_ENABLED=true の現在、main への push は即 elxea.com への本番配信になる。
#   よって「PR を経由させる」強制を手元の git hook で作るのが唯一の手段。
#
# どこから呼ばれるか:
#   .pre-commit-config.yaml の local hook。
#     pre-commit stage → main-guard.sh commit
#     pre-push  stage  → main-guard.sh push
#   hook 実体は .git/hooks/ に生成される。git は worktree 間で .git/hooks を共有するので、
#   1 回 install すればこのリポの全 worktree に効く。
#
# 判断ロジックは main-guard-lib.sh の純関数 mg_decide にある (unit test 対象)。
# このファイルは「git から事実を集める」「拒否する」「監査ログを書く」だけを担当する。
#
# 緊急バイパス (黙って外せる逃げ道は作らない):
#   ELXEA_MAIN_GUARD_BYPASS="10文字以上の理由" を付けて実行する。
#   それだけでは通らない。監査ログ docs/ops/main-guard-bypass-log.md に理由が
#   記録されていることまで確認する。記録が無ければ雛形を追記して拒否するので、
#   「バイパスした事実」が必ずリポジトリの変更として残る。

set -euo pipefail

MODE="${1:-}"
GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/git-guard/main-guard-lib.sh
. "$GUARD_DIR/main-guard-lib.sh"

PROTECTED="${ELXEA_MAIN_GUARD_PROTECTED:-main,master}"
BYPASS_REASON="${ELXEA_MAIN_GUARD_BYPASS:-}"
AUDIT_LOG_REL="docs/ops/main-guard-bypass-log.md"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "[main-guard] 拒否: git リポジトリのルートを特定できません (fail-closed)。" >&2
  exit 1
fi
AUDIT_LOG="$REPO_ROOT/$AUDIT_LOG_REL"

# --- 事実収集: 「いまどこへ書こうとしているか」を ref に入れる ------------------

REF=""
case "$MODE" in
  commit)
    # 通常は現在のブランチ名。
    REF="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    if [ -z "$REF" ]; then
      # detached HEAD。HEAD が保護ブランチの先端と同一なら、その上に積む行為は
      # 実質 main を進めることなので保護対象として扱う。先端でなければ main を
      # 動かしようがないので通す (rebase / cherry-pick を巻き添えにしない)。
      head_sha="$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)"
      if [ -z "$head_sha" ]; then
        # 初回コミット等。保護ブランチの先端ではありえないので通す。
        REF="__detached_unborn__"
      else
        REF="__detached__"
        for candidate in ${PROTECTED//,/ }; do
          cand_sha="$(git rev-parse --verify --quiet "refs/heads/$candidate" 2>/dev/null || true)"
          if [ -n "$cand_sha" ] && [ "$cand_sha" = "$head_sha" ]; then
            REF="$candidate"
            break
          fi
        done
      fi
    fi
    ;;
  push)
    # pre-push stage では pre-commit が push 先を環境変数で渡す。
    # 「どのローカルブランチか」ではなく「リモートのどのブランチへ入るか」で判定する
    # (git push origin HEAD:main のような迂回を捕まえるため)。
    REF="$(mg_normalize_ref "${PRE_COMMIT_REMOTE_BRANCH:-}")"
    ;;
  *)
    echo "[main-guard] 拒否: 使い方が不正です (mode=commit|push, 受領値='${MODE}')。" >&2
    exit 1
    ;;
esac

# --- 監査ログに理由が載っているか -------------------------------------------
# commit 時は index (= これから作るコミットの中身) を見る。working tree に書いただけで
# コミットに含めない、という抜けを塞ぐため。
# push 時は HEAD の中身を見る (記録が既にコミット済みであることを要求する)。

record_present=no
if [ -n "$BYPASS_REASON" ]; then
  case "$MODE" in
    commit) logged="$(git show ":$AUDIT_LOG_REL" 2>/dev/null || true)" ;;
    push) logged="$(git show "HEAD:$AUDIT_LOG_REL" 2>/dev/null || true)" ;;
    *) logged="" ;;
  esac
  if printf '%s' "$logged" | grep -qF -- "$BYPASS_REASON"; then
    record_present=yes
  fi
fi

DECISION="$(mg_decide "$MODE" "$REF" "$PROTECTED" "$BYPASS_REASON" "$record_present")"

case "$DECISION" in
  ALLOW)
    exit 0
    ;;
  BYPASS)
    echo "[main-guard] 緊急バイパスで通しました (mode=$MODE ref=$REF)。" >&2
    echo "[main-guard] 理由: $BYPASS_REASON" >&2
    echo "[main-guard] この事実は $AUDIT_LOG_REL に記録済みです。" >&2
    exit 0
    ;;
esac

# --- ここから拒否経路 --------------------------------------------------------

echo "" >&2
echo "==============================================================" >&2
echo " [main-guard] 拒否しました: $DECISION" >&2
echo "==============================================================" >&2

case "$DECISION" in
  DENY:protected)
    if [ "$MODE" = commit ]; then
      echo " main への直接コミットは禁止です (現在: $REF)。" >&2
      echo "" >&2
      echo " 正しい手順:" >&2
      echo "   git switch -c feat/<作業名>   # 作業ブランチを切る" >&2
      echo "   git commit ...                # そこでコミットする" >&2
      echo "   gh pr create                  # PR を作って CI 緑を確認しマージ" >&2
    else
      echo " main への直接 push は禁止です (push 先: $REF)。" >&2
      echo "" >&2
      echo " DEPLOY_ENABLED=true のため、main への push は即 elxea.com への本番配信です。" >&2
      echo " 作業ブランチを push して PR 経由でマージしてください。" >&2
    fi
    ;;
  DENY:undetermined)
    echo " 書き込み先を特定できませんでした (mode=$MODE ref='$REF')。" >&2
    echo " 素通りさせると保護が無いのと同じになるため、拒否側に倒しています。" >&2
    if [ "$MODE" = push ]; then
      echo " pre-commit が PRE_COMMIT_REMOTE_BRANCH を渡していない可能性があります。" >&2
      echo " 'pre-commit install --hook-type pre-commit --hook-type pre-push' を確認してください。" >&2
    fi
    ;;
  DENY:bypass-reason-too-short)
    echo " ELXEA_MAIN_GUARD_BYPASS の理由が短すぎます (${MG_MIN_REASON_LEN} 文字以上)。" >&2
    echo " 後から読んで何が起きたか分かる理由を書いてください。" >&2
    ;;
  DENY:bypass-not-recorded)
    echo " バイパスの理由が監査ログに記録されていません。" >&2
    echo " 雛形を $AUDIT_LOG_REL に追記しました。内容を確認して次を実行してください:" >&2
    echo "" >&2
    if [ "$MODE" = commit ]; then
      echo "   git add $AUDIT_LOG_REL   # 記録をこのコミットに含める" >&2
      echo "   # そのうえで同じ ELXEA_MAIN_GUARD_BYPASS を付けて再実行" >&2
    else
      echo "   git add $AUDIT_LOG_REL && git commit -m 'chore: main-guard バイパス記録'" >&2
      echo "   # 記録をコミットしたうえで同じ ELXEA_MAIN_GUARD_BYPASS を付けて再実行" >&2
    fi
    {
      printf '\n'
      printf -- '- %s / mode=%s / ref=%s / user=%s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$MODE" "$REF" "$(git config user.name 2>/dev/null || echo unknown)"
      printf -- '  理由: %s\n' "$BYPASS_REASON"
    } >>"$AUDIT_LOG"
    ;;
esac

echo "" >&2
echo " 緊急時にどうしても外す場合 (記録が残ります):" >&2
echo "   ELXEA_MAIN_GUARD_BYPASS=\"<${MG_MIN_REASON_LEN}文字以上の理由>\" <コマンド>" >&2
echo " 詳細: docs/ops/main-guard.md" >&2
echo "==============================================================" >&2
echo "" >&2
exit 1
