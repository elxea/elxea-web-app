/**
 * 品目ページの「産地」ブロック。地図 1 枚と、その脇 (SP では下) の産地情報。
 *
 * 正本: PC https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-3
 *       SP https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-26
 *
 * ## 文字を地図に重ねない
 *
 * 地名も仕入先名も地図の外に置く。地図の中に文字を入れないのは、書体・字間・色を
 * 自前で制御するためであり、同時に陸と海をまたぐ位置でコントラスト比が
 * 4.29:1 まで落ちる (AA 不合格) のを構造的に避けるためでもある。
 * SP は単純縮小ではなく縦積みに再設計する — 地図は幅いっぱい・高さ 180 に詰め、
 * 文字は地図の下へ積む。
 *
 * ## 産地が引けない銘柄では何も出さない
 *
 * 座標が無い銘柄で空の枠だけ出すと「地図が壊れている」ように見える。
 * `resolveTeaOrigin` が座標を返さないときは、ブロックごと描かない。
 */

import type { CSSProperties } from "react";

import {
  resolveTeaOrigin,
  resolveTeaOriginPlace,
  resolveTeaSupplier,
} from "@/lib/roji/tea-origins";
import { ITEM_MAP_SIZE } from "@/lib/viz/map-style";

import { OriginMapFrame } from "./origin-map-frame";

/**
 * 地図の寸法は `ITEM_MAP_SIZE` (Figma 実測) を正本とし、CSS 変数で渡す。
 * 高さは「ピンを上端から 57px に置く」計算の入力でもあるので、className に
 * px を直書きして正本と二重に持たない。
 */
const MAP_SIZE_VARS = {
  "--origin-map-h-sp": `${ITEM_MAP_SIZE.sp.height}px`,
  "--origin-map-h-pc": `${ITEM_MAP_SIZE.pc.height}px`,
  "--origin-map-w-pc": `${ITEM_MAP_SIZE.pc.width}px`,
} as CSSProperties;

export interface TeaOriginBlockProps {
  /** 銘柄番号 (5 桁)。Sanity `teaMenu.productNumber`。 */
  menuNumber: string | number | null | undefined;
  /** セクション見出し (i18n 済みの文字列)。 */
  heading: string;
  /**
   * 地図の代替テキスト (i18n 済みの文字列)。
   *
   * 地図の中に文字を置かないので、地図が何を指しているかはここでしか伝わらない。
   * 訳文の組み立て (産地名の差し込み) は next-intl を持つ呼び出し側で行う —
   * この層が翻訳名前空間に依存すると、i18n 文脈の無い
   * `app/dev/origin-map` から使えなくなるため。
   */
  mapLabel: string;
}

export function TeaOriginBlock({ menuNumber, heading, mapLabel }: TeaOriginBlockProps) {
  if (menuNumber === null || menuNumber === undefined) return null;

  const origin = resolveTeaOrigin(String(menuNumber));
  if (origin.lat === null || origin.lng === null) return null;

  const supplier = resolveTeaSupplier(String(menuNumber));
  const place = resolveTeaOriginPlace(String(menuNumber));

  return (
    <section className="mb-16 md:mb-24" data-slot="tea-origin-block">
      <h2 className="text-sm font-medium mb-6">{heading}</h2>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <OriginMapFrame
          lat={origin.lat}
          lng={origin.lng}
          label={mapLabel}
          style={MAP_SIZE_VARS}
          className={
            "h-[var(--origin-map-h-sp)] w-full shrink-0 " +
            "md:h-[var(--origin-map-h-pc)] md:w-[var(--origin-map-w-pc)]"
          }
        />

        {/* eslint-disable-next-line elxea-tokens/no-raw-colors -- 420px は Figma
            実測の本文カラム幅 (node 8229:3)。spacing スケールに該当値が無く、
            近い刻みに丸めると地図 400px との対比が崩れる。 */}
        <div className="flex flex-col items-start gap-3 md:w-[420px] md:gap-4">
          {place && (
            /* 0.06em は Figma 実測の字間 (node 8229:3)。letterSpacing トークンは
               0.05em と 0.1em しか持たず、どちらに寄せても組みが変わる。 */
            // eslint-disable-next-line elxea-tokens/no-raw-colors -- Figma 実測の字間
            <p className="text-sm leading-[1.65] tracking-[0.06em] text-foreground">
              {place}
            </p>
          )}
          {supplier && (
            <p className="text-2xl font-light leading-[1.3] text-brand-graphite md:text-3xl">
              {supplier}
            </p>
          )}
          <div className="h-px w-10 bg-brand-stone md:w-12" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
