#!/usr/bin/env bash
# pre-push-guard.sh --- push 先が保護ブランチかを git の生の pre-push 入力から判定する。
#
# なぜ pre-commit フレームワークの pre-push stage だけに任せないのか (実測した穴):
#   pre-commit は pre-push で「新しいリモートブランチを作る push」かつ
#   「積む commit が既に他の remote ref に存在する」場合、hook を 1 つも実行せずに
#   終了する (hook_impl の _pre_push_ns が None を返し、その時点で return 0)。
#   このため `git push origin feat/x:main` (= 作業ブランチをそのまま main に昇格させる)
#   が素通りしうる。これは本番配信が走る最も危険な操作なので、フレームワークの
#   スキップ判定より手前で見る必要がある。
#
# どこで動くか:
#   .git/hooks/pre-push.legacy として設置する (install-hooks.sh が行う)。
#   pre-commit が生成する .git/hooks/pre-push は、自身の判定に入る前に legacy hook を
#   無条件に呼び、stdin もそのまま渡す。よってスキップ判定に影響されない。
#
# stdin の形式 (git の pre-push プロトコル):
#   <local ref> <local sha> <remote ref> <remote sha>
#   ブランチ削除の push では local sha が 0 で埋まる。削除も止めたいので同じ扱いにする。

set -uo pipefail

GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/git-guard/main-guard-lib.sh
. "$GUARD_DIR/main-guard-lib.sh"

PROTECTED="${ELXEA_MAIN_GUARD_PROTECTED:-main,master}"
BYPASS_REASON="${ELXEA_MAIN_GUARD_BYPASS:-}"
AUDIT_LOG_REL="docs/ops/main-guard-bypass-log.md"

record_present=no
if [ -n "$BYPASS_REASON" ]; then
  if git show "HEAD:$AUDIT_LOG_REL" 2>/dev/null | grep -qF -- "$BYPASS_REASON"; then
    record_present=yes
  fi
fi

deny() {
  echo "" >&2
  echo "==============================================================" >&2
  echo " [main-guard/pre-push] 拒否しました: $1" >&2
  echo "==============================================================" >&2
  echo " push 先: $2" >&2
  echo "" >&2
  echo " DEPLOY_ENABLED=true のため、main への push は即 elxea.com への本番配信です。" >&2
  echo " 作業ブランチを push し、PR 経由でマージしてください。" >&2
  echo "" >&2
  echo " 緊急時 (記録が残ります): ELXEA_MAIN_GUARD_BYPASS=\"<理由>\" git push ..." >&2
  echo " 詳細: docs/ops/main-guard.md" >&2
  echo "==============================================================" >&2
  echo "" >&2
  exit 1
}

saw_line=no
while read -r _local_ref _local_sha remote_ref _remote_sha; do
  # 空行は無視。read が何も拾わないまま終わった場合は push 対象なしなので通す
  # (git は push するものが無ければそもそも hook を呼ばない)。
  [ -z "${remote_ref:-}${_local_ref:-}" ] && continue
  saw_line=yes

  if [ -z "${remote_ref:-}" ]; then
    # 行はあるのに push 先が読めない = 判断材料が壊れている。素通りさせない。
    deny "DENY:undetermined" "(解釈できない pre-push 入力)"
  fi

  decision="$(mg_decide push "$remote_ref" "$PROTECTED" "$BYPASS_REASON" "$record_present")"
  case "$decision" in
    ALLOW) ;;
    BYPASS)
      echo "[main-guard/pre-push] 緊急バイパスで通しました (push 先=$remote_ref)。" >&2
      echo "[main-guard/pre-push] 理由: $BYPASS_REASON ($AUDIT_LOG_REL に記録済み)" >&2
      ;;
    *) deny "$decision" "$remote_ref" ;;
  esac
done

[ "$saw_line" = yes ] || true
exit 0
