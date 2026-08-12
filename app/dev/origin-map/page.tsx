import type { Metadata } from "next";

import { TeaOriginBlock } from "@/components/viz/map/tea-origin-block";
import {
  TEA_MENU_NUMBERS,
  resolveTeaOriginPlace,
  resolveTeaSupplier,
} from "@/lib/roji/tea-origins";

/**
 * 産地の地図のプレビュー面。
 *
 * 品目ページ本番の描画は Sanity の `teaMenu.productNumber` に依存するが、
 * Sanity 側の銘柄はまだ 3 件のダミー (採番が 5 桁でない) しか無い。
 * 実データが入るまで実機で見た目を確認できる場所が要るのでここに置く。
 * 本番のナビゲーションからはリンクしない (`app/dev/layout.tsx` で noindex)。
 *
 * 例: /dev/origin-map?tea=10101   (しばきり園 / 静岡県 静岡市)
 *     /dev/origin-map?tea=51001   (つしま大石農園 / 長崎県 対馬市上県町)
 */

export const metadata: Metadata = {
  title: "産地の地図 preview",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OriginMapPreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const requested = first(params.tea);
  const menuNumber =
    requested && TEA_MENU_NUMBERS.includes(requested as (typeof TEA_MENU_NUMBERS)[number])
      ? requested
      : "10101";

  // このプレビュー面は `[locale]` の外にあり next-intl の文脈を持たない。
  // 本番と同じ日本語の訳文を messages/ja.json から手で写すと二重管理になるので、
  // ここは「プレビュー用の素の文字列」と割り切って組み立てる。
  const place = resolveTeaOriginPlace(menuNumber);
  const mapLabel = place ? `${place} の位置を示した地図` : "産地の位置を示した地図";

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <TeaOriginBlock menuNumber={menuNumber} heading="産地" mapLabel={mapLabel} />

      {/* プレビュー面にだけ置く読み出し。本番の産地ブロックは数値もキーも出さない。 */}
      <p className="text-xs text-muted-foreground">
        preview: {menuNumber} / {resolveTeaSupplier(menuNumber) ?? "-"}
      </p>
    </main>
  );
}
