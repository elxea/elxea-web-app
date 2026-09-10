import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  ProfileSurface,
  type ProfileSurfaceLabels,
} from "@/components/viz/profile/profile-surface";
import { env } from "@/lib/config";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

/**
 * roji プロファイル (ミクロ⇔マクロ) の正式ページ。
 *
 * 正本: Spec https://app.notion.com/p/3d270c9d064c8171b70be803150d6d5d
 * 決定: Decision Log https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac (追記 3)
 *
 * ## なぜ `/{locale}/account/profile` ではなくここなのか
 *
 * Spec の当初案 (D2) は公開時の置き場所を `/{locale}/account/profile` としていた。
 * 理由は「ログイン必須の既存領域がそこだから」。**その前提が Setaka 決定で変わった。**
 *
 * 決定 (2026-09-06): 「本番環境はベーシック認証で誰も見られないので、本番で
 * 見られるようにしてよい。新しく作るページはディレクトリを切って正式なページ
 * として入れる」。目的は **Setaka が本番でこの面を見られること**である。
 *
 * `/{locale}/account/**` は `middleware.ts` が顧客セッション (Shopify / LINE) の
 * cookie を要求し、無いと `/login` へ送る。運営が見るために顧客ログインを一度
 * 通す必要があり、決定の目的とまっすぐ衝突する。よって `account/` の外に置く。
 *
 * ## 何も晒していない (置き場所を移して増える露出は無い)
 *
 * この面が読む 3 本の GET のうち、`field` と `words` は元から認証不要
 * (集計値・匿名化済み)、`self` だけが `requireAuth()` 必須で、未ログインでは
 * 401 → 画面は「自分の粒」を描かないだけになる (`profile-stage.tsx` の
 * `fetchJson` が 401 を null に倒す)。**ログイン無しで見えるものが増えていない。**
 * 加えて本番は `SITE_PASSWORD` の門の内側にあり、この面自体も
 * `PROFILE_MICRO_MACRO` が立っている環境にしか存在しない。
 *
 * ログイン済みの人がこの URL を開けば `self` は本人の値を返す。つまり
 * `account/` 配下に置いた場合の見え方は、この置き場所の**部分集合**である。
 *
 * ## 名前はまだ無い
 *
 * 見出しも `<title>` の固有名も置いていない。名称は Setaka が決める (仮の名前を
 * 発明して既成事実にしない)。決まったら `messages/{ja,en}.json` の `profile.title`
 * を足し、ここと `generateMetadata` の 2 か所を埋める。
 */

export function generateMetadata(): Metadata {
  return {
    /* 固有名が決まるまではサイト名だけ (`| elxea` のテンプレートを通さない)。 */
    title: { absolute: "elxea" },
    /* 段階公開の面。いまは `SITE_PASSWORD` の内側だが、門が外れたあとも
       検索に載らないよう noindex はページ側に持たせておく (`/dev/*` の 404 と
       同じ意図を、公開ルートで実現できる範囲で置く)。 */
    robots: { index: false, follow: false },
  };
}

export default async function ProfilePage() {
  /* フラグが無い環境では **存在しない** 扱いにする。「無効です」と書いた面を
     返すと、面があること自体が漏れる (`/dev/*` を本番で 404 にしているのと
     同じ判断)。 */
  if (!env("PROFILE_MICRO_MACRO")) {
    notFound();
  }

  const t = await getTranslations("profile");

  const labels: ProfileSurfaceLabels = {
    facetGroup: t("facetGroup"),
    categoryGroup: t("categoryGroup"),
    facets: {
      tea: t("facetTea"),
      reading: t("facetReading"),
      event: t("facetEvent"),
    },
    categories: {
      green: t("categoryGreen"),
      red: t("categoryRed"),
      oolong: t("categoryOolong"),
    },
    stage: {
      tea: t("stageTea"),
      reading: t("stageReading"),
      event: t("stageEvent"),
    },
    zoom: t("zoom"),
  };

  /* 上部ナビ (レイアウトの Header) の下に板だけを置く。見出し・説明文は置かない
     — roji は説明しない (Spec §「操作・アクセシビリティ」)。地の色は板と同じ
     生成り (`kinari`) で、板とページの境目を作らない。 */
  return (
    <div
      data-slot="profile-page"
      className="px-4 py-10 md:px-8 md:py-14"
      style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
    >
      <ProfileSurface labels={labels} className="mx-auto max-w-5xl" />
    </div>
  );
}
