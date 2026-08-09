import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TastingNoteForm } from "./tasting-note-form";

/**
 * AI ティーコンシェルジュ体験のアンケート /ja/tasting-note/feedback。
 *
 * ## なぜ /ja/tasting-note から移したのか
 *
 * このフォームは **roji のテイスティングノート (飲んだ記録) ではない**。
 * elxea の AI ティーコンシェルジュ体験に対する CSAT / NPS アンケート
 * (「ベータテスト用『テイスティングノート』風アンケート UI」で作られたもの) で、
 * 設問は満足度・再利用意向・良かった点・改善点・推奨度の 5 問。送信先は
 * `/api/survey` → cx-agent の survey エンドポイント。
 *
 * 一方 roji R2 でいう「テイスティングノート」はお茶カルテ内の
 * 「飲んだ記録」(`8105:1125`)。名前が同じだけで中身が別物なので、Structure DB の
 * IA どおり `/ja/tasting-note` を R2 の飲んだ記録に譲り、アンケートは
 * 子ルート `/feedback` に退避した。**機能は変えていない** (フォーム本体・i18n
 * 名前空間 `tastingNote` ・送信先はそのまま)。
 *
 * 参照元も合わせて付け替えた: `components/chat/tasting-note-cta.tsx` の
 * 「体験を記録する →」。
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tastingNote");
  return {
    title: t("title"),
    description: t("subtitle"),
    /* アンケートは検索結果に出す価値が無く、飲んだ記録と紛れるので除外する。 */
    robots: { index: false, follow: false },
  };
}

export default async function TastingNoteFeedbackPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-20 md:py-24">
      <div className="w-full max-w-xl">
        {/* 変A: 中央寄せ editorial header (Figma 6728:120) */}
        <div className="text-center mb-10 md:mb-12">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Tasting Note
          </p>
          <h1 className="text-2xl font-normal">Tasting Note</h1>
        </div>
        <TastingNoteForm />
      </div>
    </div>
  );
}
