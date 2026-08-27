"use client";

import { useEffect } from "react";

import { logger } from "@/lib/log";

/**
 * 画面がまるごと落ちたときの最後の受け皿。
 *
 * 記録は `lib/log` を通す (憲章 Wave 3 / R1)。素の `Sentry.captureException(error)`
 * だと (1) どの受け皿で落ちたかが後から分からず (2) サーバ由来のメッセージに
 * 顧客のメールアドレスが混ざったまま外へ出ていた。`digest` は Next がサーバの
 * 例外に付ける識別子で、サーバ側のログと突き合わせる唯一の手がかりなので必ず残す。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("ui.boundary.global", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            textAlign: "center",
            fontFamily: "Inter, sans-serif",
            color: "#333",
            backgroundColor: "#FFFEF2",
          }}
        >
          <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
            予期しないエラーが発生しました
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#666",
              marginBottom: "40px",
              maxWidth: "400px",
            }}
          >
            申し訳ございません。ページの読み込み中にエラーが発生しました。
          </p>
          <button
            onClick={reset}
            style={{
              border: "1px solid #333",
              padding: "12px 32px",
              fontSize: "13px",
              fontWeight: 500,
              backgroundColor: "transparent",
              cursor: "pointer",
            }}
          >
            再試行する
          </button>
        </div>
      </body>
    </html>
  );
}
