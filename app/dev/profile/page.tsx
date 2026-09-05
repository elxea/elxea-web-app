import type { Metadata } from "next";

import { env } from "@/lib/config";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";
import { ProfileDevPreview } from "./preview";

/**
 * roji プロファイル (ミクロ⇔マクロ) の段1確認面。
 *
 * `/dev/*` の遮断は `middleware.ts` の唯一の機械的な遮断ルート (本番は404)。
 * 新しい遮断機構は作らない (単一正本・Spec §「置き場所」)。
 *
 * `PROFILE_MICRO_MACRO` フラグが立っていないときは無効の告知だけを出す —
 * `/dev/*` はミドルウェアで既に閉じているが、段3で `account/profile` に
 * 移設したときも同じフラグでロールアウトを絞れるようにするため、ここで先に
 * 動作を揃えておく。
 *
 * 実データは Spec 実測時点でほぼ0件 (roji会員0名) のため、既定は
 * `PROFILE_DATA_SOURCE=synthetic` での確認になる (D10: 段1の完了条件は
 * 「実データが見える」ではなく「配管が通り、生成データで動き、テストが通る」)。
 */

export const metadata: Metadata = {
  title: "roji プロファイル preview",
  robots: { index: false, follow: false },
};

const PAGE_STYLE = {
  backgroundColor: ROJI_VIZ_COLOR.kinari,
  color: ROJI_VIZ_COLOR.sumi,
  fontFamily: ROJI_VIZ_SERIF,
} as const;

export default function ProfileDevPage() {
  if (!env("PROFILE_MICRO_MACRO")) {
    return (
      <main className="min-h-screen w-full px-6 py-24" style={PAGE_STYLE}>
        <p>PROFILE_MICRO_MACRO が無効です。</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full px-6 py-16" style={PAGE_STYLE}>
      <h1 className="mb-6 text-2xl">roji プロファイル — 入れ子の一粒 (段1)</h1>
      <ProfileDevPreview />
    </main>
  );
}
