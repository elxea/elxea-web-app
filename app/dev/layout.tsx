import type { Metadata } from "next";

/**
 * `/dev/*` — 実装確認用のプレビュー面。本番のナビゲーションからは一切リンクしない。
 *
 * `app/layout.tsx` は `children` を返すだけで、`<html>` / `<body>` は
 * `app/[locale]/layout.tsx` が持っている。`/dev` は i18n の外に置く
 * (ロケール接頭辞もヘッダー・フッターも要らない) ので、この階層で最小の
 * ドキュメント骨格だけを自前で持つ。
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="bg-background text-foreground">{children}</body>
    </html>
  );
}
