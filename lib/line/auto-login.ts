import type { NextRequest } from "next/server";

/**
 * LINE 自動ログイン (auto login) の失敗からの復帰。
 *
 * 何のための仕組みか
 * ------------------
 * スマホで「LINEでログイン」を押したとき、access.line.me のメール/パスワード/QR 画面を
 * 経ずに LINE アプリの認証へ直行するのは LINE の「自動ログイン」機能である。これは
 * **既定で有効** で、有効化するパラメータは存在しない。逆に、
 *
 *   - `prompt=login`            … 自動ログインを無効化する (公式に明記)
 *   - `disable_auto_login=true` … 自動ログインを無効化する (既定 false)
 *
 * の 2 つだけが無効化の手段である。access.line.me の画面下部にある
 * 「LINEアプリでログイン」へ直行させる URL パラメータは公式に存在しない。
 * したがって「アプリ直行」のためにコード側でできることは、
 * (1) 上記 2 つを送らないこと、(2) 認可 URL を **ユーザーの実タップ** で開くこと、の 2 点に尽きる
 * (JavaScript リダイレクト / URL 直打ちは Universal Links を発火させないと公式に明記)。
 * どちらも本リポジトリでは既に満たしている (line-login-button.tsx の設計メモ参照)。
 *
 * 残る問題は「自動ログインが環境要因で失敗したとき」である。自動ログインは iOS の
 * Universal Links / Android の App Links の上に成立しており、プライベートブラウズや
 * OS 側の事情で発火しないことがある (LINE 自身が「OS の仕様は完全には公開されていない」と
 * 明言)。失敗しても LINE は callback へ戻すが、`code` は交換できない値になり `state` は
 * 一致しない。よって **素朴に再試行すると同じ失敗を繰り返す無限ループ** になる。
 *
 * LINE が公式に示す復帰手順が `disable_auto_login=true` を付けた認可 URL での再試行であり、
 * 本モジュールはその「再試行かどうか」の判定 1 点だけを担う。
 *
 * 一次情報:
 *   https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 *   https://developers.line.biz/en/docs/line-login/integrate-line-login/#line-auto-login
 */

/**
 * 自動ログイン失敗を callback からログイン画面へ伝えるためのクエリキーと値。
 *
 * `state` 不一致は「自動ログイン失敗」と「CSRF 攻撃」の区別がつかない (これも公式に明記)。
 * よってこのフラグは *ヒント* であり、認可の判断には一切使わない。使い道は
 * 「次の 1 回だけ自動ログインを切る」という UX 上の分岐だけである。
 */
export const AUTO_LOGIN_FAILED_PARAM = "autologin";
export const AUTO_LOGIN_FAILED_VALUE = "failed";

/**
 * 認可 URL 生成側 (`/api/line-login`, `/api/line-login/init`) が
 * `disable_auto_login=true` を付けるべきかを判定する。
 *
 * 呼び出し側は `?disable_auto_login=1` (または `true`) を付けて要求する。
 * 既定は **付けない** — 既定で付けてしまうと、この導線が存在する理由である
 * 「LINE アプリへの受け渡し」そのものを毎回潰すことになる。
 */
export function wantsAutoLoginDisabled(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get("disable_auto_login");
  return raw === "1" || raw === "true";
}

/**
 * ログイン画面の URL (クエリ文字列) に自動ログイン失敗フラグが立っているか。
 *
 * クライアント側 (`line-login-button.tsx`) が `window.location.search` を渡す。
 * `URLSearchParams` を直接受けるのではなく文字列を受けるのは、テストから
 * ブラウザ非依存で叩けるようにするため。
 */
export function autoLoginFailedInSearch(search: string): boolean {
  return (
    new URLSearchParams(search).get(AUTO_LOGIN_FAILED_PARAM) ===
    AUTO_LOGIN_FAILED_VALUE
  );
}
