"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * マイページの「LINEと連携する」ボタン（P2）。
 *
 * ## 何が変わったのか
 *
 * 以前はここが `<a href="https://liff.line.me/{LIFF_ID}">` だった。LIFF permanent link は
 * **LINE アプリ / LINE 内ブラウザへ離脱する**ので、Chrome で押した人は Safari か LINE 内
 * ブラウザに移され、そこには Shopify のログインが無い。だから 1 回目は失敗し、成功しても
 * 「トークに戻る」しか出口が無く、元のマイページには戻れなかった。
 *
 * P2 では LIFF を通らない。`/api/user/line-link/init` が組み立てた access.line.me の
 * 認可 URL を、**同じブラウザのまま**開き、`/api/user/line-link/callback` が同じブラウザの
 * マイページへ 302 で戻す。
 *
 * ## なぜ authUrl を先読みして `<a>` に載せるのか（`window.location` ではなく）
 *
 * スマホで access.line.me のメール/QR 画面を出さずに LINE アプリへ渡すのは LINE の
 * 「自動ログイン」で、これは **ユーザーの実 `<a>` タップ**でしか発火しない。JavaScript
 * リダイレクトも、自前 URL からの 302 も Universal Link を発火させない（Chrome iOS で顕著）。
 * だから mount 時に init を叩いて URL を確定させ、押した瞬間はただのリンク遷移にする。
 * この構造は `app/[locale]/login/line-login-button.tsx` と同じで、理由も同じ。
 * **`window.location.href = authUrl` に「簡略化」しないこと。**
 *
 * ## 4 つの表示状態
 *
 * - 準備中 … init 応答待ち。押せない（往復 1 回なので普通は一瞬）
 * - 準備完了 … 認可 URL を載せたリンク
 * - 非表示 … 503（このデプロイに連携の設定が無い）。壊れた導線を見せるより出さない
 * - **やり直せる** … 準備に失敗した。理由を言って、もう一度試せるボタンにする
 *
 * 既に連携済みだった場合、init は authUrl を返さず `alreadyLinked` を返す。そのときは
 * `router.refresh()` でサーバ側を引き直し、P1 の「連携済み」表示に切り替わらせる
 * （連携完了画面は出さない = 要件 4）。
 *
 * ## 「準備中」で永久に固まっていた（as-is D-4）
 *
 * 以前この `catch` は 503 / 401 のときだけ導線を畳み、**それ以外は何もしなかった**。
 * ところが回線断・DNS 失敗・CORS などで `fetch` 自体が失敗すると、`catch` に届くのは
 * ステータス番号ではなく `TypeError` である。どちらの条件にも当たらないので `hidden`
 * も `authUrl` も変わらず、**`disabled aria-busy` のボタンが画面に残り続ける**。
 * お客さまから見れば「連携ボタンが灰色のまま永久に押せない」で、理由も出ない。
 *
 * いまは「答えが返ってこなかった」を独立した状態として持ち、押せるボタン + 一言に
 * 倒す。分からないことを分からないと言い、次の行動（もう一度）を必ず残す
 * （設計書 M-3「画面は照会失敗時に嘘をつかない」）。
 */
type CtaState = "preparing" | "ready" | "hidden" | "failed";

export function LineLinkageCta({
  label,
  retryLabel,
  failedNote,
}: {
  label: string;
  /** 準備に失敗したときのボタン文言（「もう一度試す」等）。 */
  retryLabel: string;
  /** 準備に失敗したときに添える一言。原因は伏せてよいが、黙らない。 */
  failedNote: string;
}) {
  const router = useRouter();
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [state, setState] = useState<CtaState>("preparing");
  /** 「もう一度」で effect を再実行するための通し番号。 */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    /* 「準備中」へ戻すのは effect ではなく押下ハンドラ側でやる (effect の中で
       同期に setState すると連鎖描画になり、lint も止める)。 */
    fetch("/api/user/line-link/init", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(res.status),
      )
      .then((data: { authUrl?: string; alreadyLinked?: boolean }) => {
        if (cancelled) return;
        if (data.alreadyLinked) {
          /* 既に繋がっている。認可へ行かせず、連携済み表示に差し替える。 */
          router.refresh();
          setState("hidden");
          return;
        }
        if (data.authUrl) {
          setAuthUrl(data.authUrl);
          setState("ready");
          return;
        }
        /* 200 なのに authUrl も alreadyLinked も無い＝応答が壊れている。
           「準備中」に見せかけて固めない。 */
        setState("failed");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        /* 503 = 「このデプロイでは連携できない」という確定状態。押せないボタンを
         * 出し続けても意味がないので導線ごと畳む。401（セッション切れ）も同様に、
         * ここで連携を促しても始まらないので出さない。 */
        if (reason === 503 || reason === 401) {
          setState("hidden");
          return;
        }
        /* それ以外（回線断の `TypeError` / 5xx / JSON 崩れ）は**やり直せる失敗**。
           灰色のまま固めず、理由を出して押せる状態に戻す。 */
        setState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  if (state === "hidden") return null;

  if (state === "failed") {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setState("preparing");
            setAttempt((n) => n + 1);
          }}
          data-testid="line-linkage-cta-retry"
        >
          {retryLabel}
        </Button>
        <p
          className="text-xs text-muted-foreground text-right"
          data-testid="line-linkage-cta-failed"
          role="status"
        >
          {failedNote}
        </p>
      </div>
    );
  }

  if (state === "preparing" || !authUrl) {
    return (
      <Button variant="outline" size="sm" className="shrink-0" disabled aria-busy="true">
        {label}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" className="shrink-0" asChild>
      {/* 外部 href（access.line.me）への実タップ。Universal Links の発火条件なので
          <Link> にも router.push にも置き換えないこと。 */}
      <a href={authUrl} data-testid="line-linkage-cta">
        {label}
      </a>
    </Button>
  );
}
