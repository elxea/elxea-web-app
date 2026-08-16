/**
 * 「わたしの茶」ページの章の枠。
 *
 * ## なぜ章に番号と一行の送りを付けるのか
 *
 * このページは 4 枚の図が縦に並ぶ。図はそれぞれ操作を持つので、読み手は
 * 「いま何を見せられていて、次に何が来るのか」を見失いやすい。番号 (漢数字) で
 * 位置を、送りの一行で **次の図へ移る理由** を渡す。roji の原則どおり算用数字は
 * 使わず、目次も進捗バーも置かない (どちらも「作業」の記号で、茶の時間と合わない)。
 *
 * ## 「ここでできること」を枠側に出す理由
 *
 * 操作の手がかりを図の中に描くと、図が説明書になる。図は黙らせたまま、枠の側に
 * 墨の細字で一行だけ置く。実装が固まったら枠ごと差し替えられる層として、
 * 意図的に図の外に置いた。
 *
 * ## 字間を className でなく style で持つ理由
 *
 * roji の見出しは字間 0.24〜0.42em で立つが、`tracking-[0.42em]` のような
 * Tailwind の任意長は ESLint `elxea-tokens/no-raw-colors`
 * (`checkArbitraryValues`) が error で止める。字間トークンはまだ無いので、
 * 色ではない値として `style` に置く (同ルールが見るのは色プロパティだけ)。
 */

import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/** roji の字間。トークン化されるまでの置き場。 */
export const ME_TRACKING = {
  /** のれん・章番号 */
  wide: "0.42em",
  /** 見出し */
  title: "0.24em",
  /** 小見出し・ラベル */
  label: "0.2em",
  /** 本文 */
  body: "0.08em",
} as const;

/**
 * 砂色の罫一本 (上辺)。
 *
 * Tailwind の `border-t` は幅しか設定しないため色が `currentColor` に落ちる。
 * ESLint `elxea-tokens/no-colorless-border` がそれを error で止めるので、
 * roji の罫はクラスではなく実値で持つ (色はパレット由来なので raw ではない)。
 */
export const HAIRLINE_TOP = {
  borderTopWidth: 1,
  borderTopStyle: "solid",
  borderTopColor: ROJI_VIZ_COLOR.suna,
} as const satisfies React.CSSProperties;

export interface MeSectionProps {
  /** 章番号 (漢数字)。算用数字は使わない。 */
  ordinal: string;
  /** 何を見ているか。 */
  title: string;
  /** 章の意図。1〜2 行。 */
  lead: string;
  /** ここで手を動かすと何が起きるか。枠側に置く細字一行。 */
  affordance: string;
  children: React.ReactNode;
  className?: string;
}

export function MeSection({
  ordinal,
  title,
  lead,
  affordance,
  children,
  className,
}: MeSectionProps) {
  return (
    <section className={cn("mx-auto w-full max-w-6xl px-6 py-16 sm:py-24", className)}>
      <header className="mb-8 sm:mb-12">
        <p
          className="mb-4 text-xs"
          style={{
            color: ROJI_VIZ_COLOR.koke,
            fontFamily: ROJI_VIZ_SERIF,
            letterSpacing: ME_TRACKING.wide,
          }}
        >
          {ordinal}
        </p>
        <h2
          className="text-2xl leading-relaxed sm:text-3xl"
          style={{
            color: ROJI_VIZ_COLOR.sumi,
            fontFamily: ROJI_VIZ_SERIF,
            letterSpacing: ME_TRACKING.title,
          }}
        >
          {title}
        </h2>
        <p
          className="mt-5 max-w-prose text-sm leading-loose sm:text-base"
          style={{
            color: ROJI_VIZ_COLOR.sumi,
            fontFamily: ROJI_VIZ_SERIF,
            letterSpacing: ME_TRACKING.body,
          }}
        >
          {lead}
        </p>
        <p
          className="mt-4 text-xs leading-loose"
          style={{
            color: ROJI_VIZ_COLOR.fukamidori,
            fontFamily: ROJI_VIZ_SERIF,
            letterSpacing: ME_TRACKING.body,
          }}
        >
          {affordance}
        </p>
      </header>
      {children}
    </section>
  );
}

/**
 * 章と章のあいだの送り。
 *
 * 「次の図を見る理由」を一行だけ置く。これが無いと 4 枚が並列のダッシュボードに
 * 見え、回遊 (自分の中 → 自分の外) の順番が読めなくなる。
 */
export function MeTransition({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6">
      <p
        className="py-10 text-center text-sm leading-loose"
        style={{
          ...HAIRLINE_TOP,
          color: ROJI_VIZ_COLOR.sumi,
          fontFamily: ROJI_VIZ_SERIF,
          letterSpacing: ME_TRACKING.label,
        }}
      >
        {children}
      </p>
    </div>
  );
}
