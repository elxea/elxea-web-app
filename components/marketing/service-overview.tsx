import * as React from "react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * ServiceOverview — Figma
 * `Service Overview (Module) — PC 1440` 7970:42142 /
 * `Service Overview (Module) — SP 375` 7970:42206。
 *
 * 実測 (AWLnI0XF07e8rScuxPYPc7) と、そこから読み取ったトークン割当:
 *
 * | 位置             | PC 1440        | SP 375        | 割当                    |
 * |------------------|----------------|---------------|-------------------------|
 * | 外余白 x         | 64             | 16            | page-container          |
 * | セクション上下   | 96             | 64            | spacing.24 / spacing.16 |
 * | head 内の行間    | 12             | 12            | spacing.3               |
 * | head → tiles     | 64             | 32            | spacing.16 / spacing.8  |
 * | tile 列          | 304 x4 gap 32  | 1 列 gap 32   | spacing.8               |
 * | tile 上端 → 見出し | 24           | 24            | spacing.6 (上罫線から)  |
 * | tile 内の行間    | 12             | 12            | spacing.3               |
 * | tiles → about    | 64             | 32            | spacing.16 / spacing.8  |
 * | link 行          | h 45 (touch44) | h 45          | 最小タッチ域 44px 充足  |
 *
 * tile の内容が y=24 から始まり枠線を持たないため、上端の 24px は「上罫線からの
 * 余白」と解釈して `border-t` を引いている (elxea の罫線主体の版面に一致)。
 *
 * コピーは持たず、すべて props で受ける (トップ / About で再利用するため)。
 */
export type ServiceOverviewTile = {
  /** 欧文キッカー (例 "TEA")。 */
  kicker: string;
  /** 和文見出し (例「お茶」)。 */
  title: string;
  /** 説明文。 */
  body: string;
  /** 遷移先。`@/i18n/navigation` の locale 付き Link に渡す。 */
  href: string;
  /** リンク文言 (例「茶葉の一覧へ」)。矢印は部品側で付ける。 */
  linkLabel: string;
};

export type ServiceOverviewProps = React.ComponentProps<"section"> & {
  /** セクション上部の欧文キッカー (例 "ELXEA — OVERVIEW")。 */
  kicker: string;
  /** セクション見出し。 */
  title: string;
  /** リード文。 */
  lead: string;
  /** サービスタイル (Figma は 4 枚。列数は 4 固定)。 */
  tiles: ServiceOverviewTile[];
  /** 末尾の About 行。 */
  about: {
    title: string;
    description: string;
    href: string;
    linkLabel: string;
  };
};

/** リンク行 — Figma `link (touch 44)` 相当。高さ 45px を最小タッチ域として確保する。 */
function OverviewLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center py-3 text-sm text-foreground underline-offset-4 hover:underline"
    >
      {children}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}

export function ServiceOverview({
  kicker,
  title,
  lead,
  tiles,
  about,
  className,
  ...props
}: ServiceOverviewProps) {
  return (
    <section
      data-slot="service-overview"
      className={cn("page-container py-16 md:py-24", className)}
      {...props}
    >
      {/* head */}
      <div className="flex flex-col gap-3">
        <p className="text-xs tracking-wider text-muted-foreground">{kicker}</p>
        {/* Figma の行高 (PC 45 / SP 36) はスケール外なので leading-10 (40) /
            leading-9 (36) に丸める。 */}
        <h2 className="text-2xl leading-9 md:text-3xl md:leading-10">
          {title}
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">{lead}</p>
      </div>

      {/* tiles — PC 4 列 (304px x4 + 32px gap x3 = 1312) / SP 1 列 */}
      <div className="mt-8 grid grid-cols-1 gap-8 md:mt-16 md:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.href}
            data-slot="service-overview-tile"
            className="flex flex-col gap-3 border-t border-border pt-6"
          >
            <p className="text-xs tracking-wider text-muted-foreground">
              {tile.kicker}
            </p>
            <h3 className="text-xl leading-8 md:text-2xl md:leading-9">
              {tile.title}
            </h3>
            <p className="text-sm leading-5 text-muted-foreground">
              {tile.body}
            </p>
            <OverviewLink href={tile.href}>{tile.linkLabel}</OverviewLink>
          </div>
        ))}
      </div>

      {/* about — PC は 1 行 (見出し / 説明 / 罫線 / リンク右端)、SP は積み上げ */}
      <div className="mt-8 flex flex-col gap-3 md:mt-16 md:flex-row md:items-center md:gap-8">
        <h3 className="text-base leading-6 whitespace-nowrap">{about.title}</h3>
        <p className="text-sm leading-5 whitespace-nowrap text-muted-foreground">
          {about.description}
        </p>
        <hr
          aria-hidden="true"
          className="hidden flex-1 border-t border-border md:block"
        />
        <OverviewLink href={about.href}>{about.linkLabel}</OverviewLink>
      </div>
    </section>
  );
}
