"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
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
