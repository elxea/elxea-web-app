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
 * ## 3 つの表示状態
 *
 * - 準備中 … init 応答待ち。押せない（往復 1 回なので普通は一瞬）
 * - 準備完了 … 認可 URL を載せたリンク
 * - 非表示 … 503（このデプロイに連携の設定が無い）。壊れた導線を見せるより出さない
 *
 * 既に連携済みだった場合、init は authUrl を返さず `alreadyLinked` を返す。そのときは
 * `router.refresh()` でサーバ側を引き直し、P1 の「連携済み」表示に切り替わらせる
 * （連携完了画面は出さない = 要件 4）。
 */
export function LineLinkageCta({ label }: { label: string }) {
  const router = useRouter();
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

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
          setHidden(true);
          return;
        }
        if (data.authUrl) setAuthUrl(data.authUrl);
      })
      .catch((status: unknown) => {
        /* 503 = 「このデプロイでは連携できない」という確定状態。押せないボタンを
         * 出し続けても意味がないので導線ごと畳む。401（セッション切れ）も同様に、
         * ここで連携を促しても始まらないので出さない。 */
        if (!cancelled && (status === 503 || status === 401)) setHidden(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (hidden) return null;

  if (!authUrl) {
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
