#!/usr/bin/env bash
# main-guard-lib.sh --- main 直接書き込みガードの「判断ロジック」だけを持つライブラリ。
#
# ここには副作用を一切置かない (git を呼ばない / ファイルを書かない / exit しない)。
# 判断が純関数であることで、本物の main に一切触れずに unit test で赤経路を証明できる。
# git を叩く部分・実際に拒否する部分は main-guard.sh 側にある。
#
# 使い方:
#   source scripts/git-guard/main-guard-lib.sh
#   mg_decide <mode> <ref> <protected_csv> <bypass_reason> <record_present>
#
# 返り値は stdout の判定コード 1 語 (終了コードでは返さない = 呼び出し側で分岐しやすくするため)。

set -u

# バイパス理由の最小文字数。「a」「x」のような無意味な理由で外せないようにする下限。
MG_MIN_REASON_LEN=10

# refs/heads/main のような完全参照名を main に落とす。
# 参照名でもブランチ名でも同じ判定にするための正規化。
mg_normalize_ref() {
  local ref="${1-}"
  ref="${ref#refs/heads/}"
  ref="${ref#refs/remotes/}"
  printf '%s' "$ref"
}

# ref が保護対象リスト (カンマ or 空白区切り) に含まれるか。
# 含まれる=0 / 含まれない=1
mg_is_protected() {
  local ref protected item
  ref="$(mg_normalize_ref "${1-}")"
  protected="${2-}"
  # カンマを空白に均して単語一致で見る (部分一致で main-fix 等を巻き込まないため)
  protected="${protected//,/ }"
  for item in $protected; do
    if [ "$ref" = "$item" ]; then
      return 0
    fi
  done
  return 1
}

# 判断本体。
#
#   $1 mode            commit | push
#   $2 ref             判定対象の参照 (commit=現在のブランチ / push=push 先ブランチ)
#   $3 protected_csv   保護対象ブランチ (例 "main,master")
#   $4 bypass_reason   緊急バイパスの理由 (空 = バイパスなし)
#   $5 record_present  バイパス記録が監査ログに載っているか (yes | no)
#
# stdout:
#   ALLOW                        通してよい
#   BYPASS                       理由と記録が揃った緊急バイパスとして通す
#   DENY:protected               保護ブランチへの直接書き込み
#   DENY:undetermined            対象が特定できない (fail-closed でここに倒す)
#   DENY:bypass-reason-too-short 理由が短すぎる
#   DENY:bypass-not-recorded     監査ログに記録が無い
mg_decide() {
  local mode ref protected reason record undetermined blocked
  mode="${1-}"
  ref="$(mg_normalize_ref "${2-}")"
  protected="${3-}"
  reason="${4-}"
  record="${5-no}"

  undetermined=no
  # mode 自体が不明なら何も保証できないので閉じる
  if [ "$mode" != "commit" ] && [ "$mode" != "push" ]; then
    undetermined=yes
  fi
  # 対象 ref が空 = 「どこへ書こうとしているか分からない」。
  # 素通り (fail-open) させると仕組みが壊れたときに無防備になるので拒否側に倒す。
  if [ -z "$ref" ]; then
    undetermined=yes
  fi

  blocked=no
  if [ "$undetermined" = yes ]; then
    blocked=undetermined
  elif mg_is_protected "$ref" "$protected"; then
    blocked=protected
  fi

  if [ "$blocked" = no ]; then
    printf 'ALLOW'
    return 0
  fi

  # ここから先は「止める理由がある」状態。バイパスが成立するかだけを見る。
  if [ -z "$reason" ]; then
    printf 'DENY:%s' "$blocked"
    return 0
  fi
  if [ "${#reason}" -lt "$MG_MIN_REASON_LEN" ]; then
    printf 'DENY:bypass-reason-too-short'
    return 0
  fi
  if [ "$record" != yes ]; then
    printf 'DENY:bypass-not-recorded'
    return 0
  fi
  printf 'BYPASS'
  return 0
}
