import type { Metadata } from "next";

import { MotionShowcase } from "./showcase";

/**
 * モーションライブラリの見本 (ショーケース) 面。
 *
 * 目的は「速さ・カーブ・動きの型」を文章ではなく **その場で動かして** 決めること。
 * 設計の正本は Spec 側にあり、この面は判断のための実機表示に徹する。
 *   Spec: https://www.notion.so/3be70c9d064c81ee82fac2f3b09f4a5f
 *
 * 本番のナビゲーションからは一切リンクしない (`app/dev/layout.tsx` で noindex、
 * `middleware.ts` は `VERCEL_ENV=production` で `/dev/*` に 404 を返す)。
 *
 * 例: /dev/motion   (`/ja/dev/motion` で来た場合はここへ 307 で寄せる)
 */

export const metadata: Metadata = {
  title: "モーション見本 (roji)",
  robots: { index: false, follow: false },
};

export default function MotionShowcasePage() {
  return <MotionShowcase />;
}
