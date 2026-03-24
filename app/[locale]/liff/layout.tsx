import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "マイページ | elxea",
  description: "elxea マイページ",
};

/**
 * LIFF-specific layout — no header/footer (renders inside LINE's browser).
 */
export default function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
