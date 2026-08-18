import type { Metadata } from "next";

import { CommunityLensBlock } from "@/components/viz/me/community/community-lens-block";
import { FlavorLensBlock } from "@/components/viz/me/flavor-lens/flavor-lens-block";
import { FootprintsBlock } from "@/components/viz/me/footprints/footprints-block";
import { WordGardenBlock } from "@/components/viz/me/garden/word-garden-block";
import {
  HAIRLINE_TOP,
  ME_TRACKING,
  MeSection,
  MeTransition,
} from "@/components/viz/me/me-section";
import { nextCups } from "@/lib/roji/me/next-cups";
import { LATEST_CUP } from "@/lib/roji/me/tea-log";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";

/**
 * 「わたしの茶」— 自分のことを深く知れるページの高解像度モックアップ。
 *
 * ## このページが答える問い
 *
 * マイページを「注文履歴と住所の置き場」から、**自分の輪郭が見える場所**へ動かす。
 * 縦の順序そのものが問いの順序になっていて、上から下へ
 * 「どこから来たか → いまどこにいるか → 何を書いてきたか → 外はどうなっているか
 * → では次はどこへ」と一続きに読める。章のあいだの送り (`MeTransition`) が
 * その繋ぎを言葉で保証する。
 *
 * ## 想定する回遊
 *
 * - **ふだん**: 一 (足あと) だけ見て閉じる。時間レンズを「この一ヶ月」にして
 *   最近の自分を確かめる、が最頻の使い方
 * - **月に一度**: 一 → 二 と降りて、好みが動いたかを見る。二の足あとレンズは
 *   既定 ON で、四象限の上に自分の来歴が重なった状態から始まる
 * - **買うとき**: 二で近い味に触れてから五へ飛び、まだ飲んでいない一杯を選ぶ
 * - **時間があるとき**: 三 (ことば) と四 (みんな) まで降りる。ここは滞在の層で、
 *   毎回は読まれない前提で下に置いてある
 *
 * ## この面の位置づけ
 *
 * `/dev/*` はプレビュー面で、本番のナビゲーションからは一切リンクしない
 * (`app/dev/layout.tsx` が noindex を持つ)。データは全てダミーで、差し替え口は
 * `lib/roji/me/*` に閉じている。図は `components/viz/me/*` を消せば元に戻る。
 *
 * 出典: viz 査定 `verdicts.md` (第6/第7ラウンドの 31 / 32 / 33 / 34)。
 */

export const metadata: Metadata = {
  title: "わたしの茶 preview",
  robots: { index: false, follow: false },
};

const PAGE_STYLE = {
  backgroundColor: ROJI_VIZ_COLOR.kinari,
  color: ROJI_VIZ_COLOR.sumi,
  fontFamily: ROJI_VIZ_SERIF,
} as const;

export default function MePreviewPage() {
  const suggestions = nextCups();

  return (
    <main className="min-h-screen w-full" style={PAGE_STYLE}>
      {/* --- のれん -------------------------------------------------------
          名前も会員番号も出さない。最初に目に入るのは「いまの一杯」で、
          ここがそのまま一 (足あと) のいちばん新しい点に繋がっている。 */}
      {/* DS-exception: dev-only 実験ページ。上端の余白 (pt-24 / sm:pt-36) は
          section-* の固定 py-16 では作れず、共有ユーティリティに寄せると
          承認済みの見た目が変わる。製品ページではないので寄せない。 */}
      <header className="mx-auto w-full max-w-6xl px-6 pt-24 pb-16 sm:pt-36 sm:pb-24">
        <h1
          className="text-3xl leading-relaxed sm:text-5xl"
          style={{ letterSpacing: ME_TRACKING.wide }}
        >
          わ た し の 茶
        </h1>
        <p
          className="mt-8 max-w-prose text-sm leading-loose sm:text-base"
          style={{ letterSpacing: ME_TRACKING.body }}
        >
          飲んできたものが、そのまま自分の輪郭になる。
          <br />
          ここには、点数も順位も置いていない。
        </p>

        <div
          className="mt-14 max-w-md pt-8"
          style={HAIRLINE_TOP}
        >
          <p
            className="text-xs"
            style={{ color: ROJI_VIZ_COLOR.koke, letterSpacing: ME_TRACKING.wide }}
          >
            い ま の 一 杯
          </p>
          <p
            className="mt-4 text-xl sm:text-2xl"
            style={{ letterSpacing: ME_TRACKING.label }}
          >
            {LATEST_CUP.label}
          </p>
          <p
            className="mt-3 text-xs"
            style={{
              color: ROJI_VIZ_COLOR.fukamidori,
              letterSpacing: ME_TRACKING.label,
            }}
          >
            {LATEST_CUP.season} ・ {LATEST_CUP.nth}
          </p>
          <p
            className="mt-5 text-sm leading-loose"
            style={{ letterSpacing: ME_TRACKING.body }}
          >
            {LATEST_CUP.voice}
          </p>
        </div>
      </header>

      {/* --- 一 どこから来たか ------------------------------------------- */}
      <MeSection
        ordinal="一"
        title="味 わ い の 足 あ と"
        lead="飲んだ一杯が味の座標に落ちて、積もっていく。古い杯ほど小さく、砂の色に沈む。何をどれだけ飲んだかではなく、どちらへ歩いてきたかが残る。"
        affordance="見る時間の幅を選ぶ。下の細い線を引くと時が遡り、点が落ちた順に消える。点に触れると、その一杯の記憶が開く。"
      >
        <FootprintsBlock label="これまでに飲んだ一杯が味の座標に積もっていく図。時間の幅を選び、時を遡ることができる。" />
      </MeSection>

      <MeTransition>では、いまはどのあたりにいるのか。</MeTransition>

      {/* --- 二 いまどこにいるか ----------------------------------------- */}
      <MeSection
        ordinal="二"
        title="好 み の 位 置"
        lead="甘み と 渋み、軽やか と 濃厚。二本の軸だけの紙の上に、茶と自分の足あとを同時に置く。自分の居場所は、まわりに何があるかで初めて分かる。"
        affordance="茶の種類を移り、自分の足あとを重ねたり外したりできる。近くに指を置くと、近い味だけが静かに香り立つ。"
      >
        <FlavorLensBlock
          label="甘み・渋み・軽やか・濃厚の四象限に銘柄を置き、自分の足あとを重ねられる図。"
          defaultFootprints
        />
      </MeSection>

      <MeTransition>
        座標では言えなかったことが、ことばの側に残っている。
      </MeTransition>

      {/* --- 三 何を書いてきたか ----------------------------------------- */}
      <MeSection
        ordinal="三"
        title="こ と ば の 庭"
        lead="一杯ごとに書きつけた短い一言が、飛び石のように置かれている。並べ直すと、自分がどんな言葉で茶を捉えてきたかが見えてくる。"
        affordance="ことばに触れると、少し大きくなって、それをどこで書いたかが浮かぶ。庭を入れ替えると、ことばが散って積もり直す。"
      >
        <WordGardenBlock label="自分が書いてきた短い一言を飛び石のように並べた庭。文脈ごとに並べ替えられる。" />
      </MeSection>

      <MeTransition>
        ここまでは自分ひとりの話。同じ茶を、ほかの誰かも飲んでいる。
      </MeTransition>

      {/* --- 四 外はどうなっているか ------------------------------------- */}
      <MeSection
        ordinal="四"
        title="み ん な の 気 配"
        lead="誰が何を飲んだかは出さない。出るのは温度のような面だけ。その面の中で、自分の足あとがどこに立っているかを確かめる。"
        affordance="みんな と じぶん のあいだを行き来する。じぶん へ寄せるほど面が薄れ、自分の杯が立ちあがってくる。"
      >
        <CommunityLensBlock label="みんなの気配の面と自分の足あとを行き来できる図。個人は一切出さない。" />
      </MeSection>

      <MeTransition>そして、まだ行っていないほうへ。</MeTransition>

      {/* --- 五 出口 -----------------------------------------------------
          自分を知るページを日記で終わらせない。ここが商品側への戻り口になる。
          「おすすめ」とは言わず、近さを言葉で言う。 */}
      {/* DS-exception: dev-only 実験ページ。下端に大きく余白を取る (pb-32 /
          sm:pb-44) のはこのページ固有の作りで、section-* の固定 py-16 では
          再現できない。 */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 pb-32 sm:py-24 sm:pb-44">
        <p
          className="mb-4 text-xs"
          style={{ color: ROJI_VIZ_COLOR.koke, letterSpacing: ME_TRACKING.wide }}
        >
          五
        </p>
        <h2
          className="text-2xl leading-relaxed sm:text-3xl"
          style={{ letterSpacing: ME_TRACKING.title }}
        >
          こ の 先 の 一 杯
        </h2>
        <p
          className="mt-5 max-w-prose text-sm leading-loose sm:text-base"
          style={{ letterSpacing: ME_TRACKING.body }}
        >
          いまの自分の近くにあって、まだ一度も飲んでいないもの。
        </p>

        <ul className="mt-12 grid gap-10 sm:grid-cols-3">
          {suggestions.map(({ tea, nearness }) => (
            <li
              key={tea.id}
              className="pt-6"
              style={HAIRLINE_TOP}
            >
              <p
                className="text-xs"
                style={{
                  color: ROJI_VIZ_COLOR.fukamidori,
                  letterSpacing: ME_TRACKING.title,
                }}
              >
                {nearness}
              </p>
              <p
                className="mt-4 text-lg"
                style={{ letterSpacing: ME_TRACKING.label }}
              >
                {tea.label}
              </p>
              <p
                className="mt-2 text-xs"
                style={{ color: ROJI_VIZ_COLOR.koke, letterSpacing: ME_TRACKING.label }}
              >
                {tea.note}
              </p>
              <p
                className="mt-4 text-sm leading-loose"
                style={{ letterSpacing: ME_TRACKING.body }}
              >
                {tea.poem}
              </p>
            </li>
          ))}
        </ul>

        <p
          className="mt-24 text-center text-xs"
          style={{ color: ROJI_VIZ_COLOR.suna, letterSpacing: ME_TRACKING.wide }}
        >
          preview / dummy data
        </p>
      </section>
    </main>
  );
}
