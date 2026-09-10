"use client";

/**
 * `/dev/profile` の面切替 (お茶 / 読み物 / イベント) とカテゴリー切替
 * (緑茶 / 紅茶 / 青茶)。
 *
 * 中身は正式ページ (`/{locale}/profile`) と同じ `ProfileSurface` に寄せてある。
 * 切替の実装をこちらにも持つと、正式ページと確認面で挙動がずれても誰も気づけない
 * (どちらが正しいかを決める根拠が無くなる)。**振る舞いは 1 か所・文言だけここ**、
 * という切り方にしてある。
 *
 * `app/dev/` は `[locale]` の外にあり `NextIntlClientProvider` の内側ではない
 * ので、ここでは `useTranslations()` を呼べない。確認面なので日本語で固定する
 * (英語の確認は `/en/profile` で行う)。
 */

import {
  ProfileSurface,
  type ProfileSurfaceLabels,
} from "@/components/viz/profile/profile-surface";

const LABELS: ProfileSurfaceLabels = {
  facetGroup: "面の切替",
  categoryGroup: "カテゴリーの切替",
  facets: { tea: "お茶", reading: "読み物", event: "イベント" },
  categories: { green: "緑茶", red: "紅茶", oolong: "青茶" },
  stage: {
    tea: "roji プロファイル — 味わいの地",
    reading: "roji プロファイル — 言葉の野",
    event: "roji プロファイル — 言葉の野",
  },
  zoom: "細かさ 粗いから細かいまで",
};

export function ProfileDevPreview() {
  return <ProfileSurface labels={LABELS} />;
}
