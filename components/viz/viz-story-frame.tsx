"use client";

/**
 * Storybook 用の地 (紙) の枠。
 *
 * roji の図は「生成りの紙の上に置く」前提で色を決めている
 * (`lib/viz/roji-viz-palette.ts`)。Storybook の既定の白地に素で置くと、
 * 図の淡い側が地に溶けて実際の見えと違ってしまう。story の中で毎回
 * 同じ style を書き写すと写し違いが起きるので、枠を 1 つに寄せる。
 *
 * 本番ページ側 (`app/[locale]/(reading)/tea-menu/**`) の地色と同じ値を
 * パレットから引くだけで、独自の色は持たない。
 */

import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";

export function VizStoryFrame({
  children,
  /** 図の上に置く見出し (章の名)。図そのものの説明文は置かない。 */
  heading,
}: {
  children: React.ReactNode;
  heading?: string;
}) {
  return (
    <div
      // 地は画面いっぱいまで伸ばす。図より下に Storybook の白地が覗くと
      // 「紙の上に置いた図」という前提が崩れ、色の見えが変わる。
      className="min-h-svh w-full px-4 py-10 sm:px-8"
      style={{
        backgroundColor: ROJI_VIZ_COLOR.kinari,
        color: ROJI_VIZ_COLOR.sumi,
        fontFamily: ROJI_VIZ_SERIF,
      }}
    >
      {heading ? (
        // `whitespace-pre` — 見出しの字間は空白で作っている。既定の折り畳みだと
        // 連続空白が 1 つに潰れて字間が消える。
        <p
          className="mb-8 text-xs whitespace-pre"
          style={{ color: ROJI_VIZ_COLOR.koke, letterSpacing: "0.42em" }}
        >
          {heading}
        </p>
      ) : null}
      {children}
    </div>
  );
}
