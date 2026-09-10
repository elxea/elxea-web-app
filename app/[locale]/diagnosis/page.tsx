import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DiagnosisForm } from "./diagnosis-form";

/**
 * 茶葉診断（Web 入口） /ja/diagnosis — CDP 統合 Stage 4「使う側の解禁」/ 欠陥 D8。
 *
 * ## なぜこのルートが今できたのか
 *
 * 好み診断は LINE にしか入口が無く、`app/[locale]/page.tsx` には「Figma の
 * 『茶葉診断への入口 (お茶カルテ)』節 (8110:2514) は `/karte` / `/diagnosis` が
 * 未実装のため出していない (存在しないルートへリンクしない)」と書かれたまま
 * 止まっていた。Stage 1 で L0 の受け口 (`diagnosis.answer`) を先に作り画面は後、
 * と決めてあったので、ここがその「後」にあたる。
 *
 * ## この画面が触るもの
 *
 * 答えの送り先は `/api/diagnosis` 1 本で、そこから先は events gateway → L0。
 * Firestore のカルテには何も書かない（persona の書き手は cx-agent 1 本という
 * 決まり。統合設計 T-1 / §6-3）。結果表示は L2（提示）であって、カルテではない。
 *
 * ## トップページの導線は本 PR に含めない（意図的）
 *
 * Figma 節 8110:2514 をコードに起こす作業は「Figma 反映の忠実度ゲート」
 * （CLAUDE.md・数値対比表 + 別エージェントの忠実度監査）の対象で、本 PR の
 * 範囲（Stage 4 の web-app 側）と検査の性質が違う。ここでは導線をフッターの
 * 「コンテンツ」列に足すに留め、トップの節は忠実度ゲートを通す別タスクに残す。
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("diagnosis");
  return {
    title: t("title"),
    description: t("subtitle"),
    openGraph: { title: t("title"), description: t("subtitle") },
  };
}

export default async function DiagnosisPage() {
  const t = await getTranslations("diagnosis");

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-20 md:py-24">
      <div className="w-full max-w-xl">
        <div className="mb-10 text-center md:mb-12">
          <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="text-2xl font-normal">{t("title")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <DiagnosisForm />
      </div>
    </div>
  );
}
