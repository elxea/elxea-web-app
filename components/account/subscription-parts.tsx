import * as React from "react";
import Image from "next/image";

import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { Badge } from "@/components/ui/badge";
import { ImagePlaceholder } from "@/components/media/image-placeholder";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SubscriptionStatusKind } from "@/lib/subscription-view";

/**
 * 定期便管理画面の DS 部品 —【R2: 確定版】(Figma section 6717:14526)。
 * PC 1440 `6717:14527` / SP 390 `6723:14747`。
 *
 * 確定版は「読み枠 1 本のなかにカードを縦に積む」構成 (マイページ本体 8095:731 の
 * ようなフルブリード帯は使わない)。よって帯部品 (AccountGreetingBand /
 * AccountOpsBand) は流用せず、ここは枠つきカード 1 種 + パネル 1 種で組む。
 *
 * Figma 実測 (px) → 実装:
 * - 外余白・内容幅      PC 80 / 1280、SP 20 / 350 → `.page-container` (64 / 1312, 16 / 358)
 *                       に従う (design-kit `conflicts[c-04]` の既知差分。カート C5-1 と同じ判断)
 * - PageHead            戻る PC pt96 / SP pt40、戻る→見出し 64 / 32、
 *                       overline→h1 12 / 8、h1→lead 12 / 8、見出し→本体 64 / 32
 * - 主見出し            全体裁定どおり `.page-title` (PC 44 display / SP 32)。
 *                       Figma は 32 固定 (6717:14568 h38) だが全体裁定が優先
 * - lead                PC 16 (jp/body h28) / SP 14 (jp/body-sm 2 行 h50)
 * - 節見出し            PC 20 (jp/h3 h27) / SP 16 (jp/h4 h24)
 *                       → globals.css `h2[data-slot="subscription-section-title"]`
 * - 節見出し→一覧      PC 24 / SP 16
 * - カード間            PC 24 / SP 16
 * - カード              padding PC 24 / SP 20、内部の段間 PC 16 / SP 12、
 *                       枠 1px `border` / 面 `card` / 角丸 8 (= `rounded-lg`、実測で確認)
 * - 商品行              thumb PC 48 / SP 44、thumb→情報 12、情報の行間 4、価格は右端
 * - パネル              padding PC 24 / SP 20、段間 PC 16 / SP 12、
 *                       見出し PC 16 (h4) / SP 14 (h5)、chips の溝 8
 * - EmptyCard           上下 32 / 中身の段間 16 / 中央寄せ、本文 16 (jp/body h28)
 * - ボタン              すべて高さ 36 = DS Button `size="default"` (h-9) と一致
 *
 * 文字組みは `typography.style.*` トークン (rule-list から再輸出した CSS 変数)、
 * 色は semantic token のみ。生 px・生カラーはこのファイルに書かない。
 */

/** `typography.style.body` — 16 / 1.75。確定版のリードと空状態の本文。 */
const BODY =
  "[font:var(--typography-style-body)] [letter-spacing:var(--typography-style-body-tracking)]";

/** SP は caption (12 / 1.5) → PC は body-sm (14 / 1.8)。 */
const CAPTION_TO_BODY_SM = cn(
  captionClass,
  "lg:[font:var(--typography-style-body-sm)] lg:[letter-spacing:var(--typography-style-body-sm-tracking)]"
);

/** SP は body-sm (14 / 1.8) → PC は body (16 / 1.75)。確定版の lead。 */
const BODY_SM_TO_BODY = cn(
  bodySmClass,
  "lg:[font:var(--typography-style-body)] lg:[letter-spacing:var(--typography-style-body-tracking)]"
);

/* -------------------------------------------------------------------------- */
/* SubscriptionPageHead — 戻る導線 + キッカー + 主見出し + リード                */
/* (PC 6717:14565 + 6717:14566 / SP 6723:14752 + 6723:14753)                    */
/* -------------------------------------------------------------------------- */

export function SubscriptionPageHead({
  backLabel,
  backHref,
  overline,
  title,
  lead,
}: {
  backLabel: React.ReactNode;
  backHref: string;
  overline: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div data-slot="subscription-page-head" className="page-container pt-10 lg:pt-24">
      <Link
        data-slot="subscription-back-link"
        href={backHref}
        className={cn(
          bodySmClass,
          "inline-block text-muted-foreground transition-colors hover:text-foreground"
        )}
      >
        {backLabel}
      </Link>

      <div className="mt-8 lg:mt-16">
        <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
        {/* 主見出しは全体裁定どおり `.page-title` (PC 44 display / SP 32)。 */}
        <h1 className="page-title mt-2 text-foreground lg:mt-3">{title}</h1>
        {lead ? (
          <p className={cn(BODY_SM_TO_BODY, "mt-2 text-muted-foreground lg:mt-3")}>
            {lead}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionSection — 節見出し + 中身 (PC 6717:14570 / SP 6723:14757)         */
/* -------------------------------------------------------------------------- */

export function SubscriptionSection({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="subscription-section"
      className={cn("page-container mt-8 lg:mt-16", className)}
    >
      {/* 体裁は globals.css の `h2[data-slot="subscription-section-title"]` 規則
          (SP h4 16 → PC h3 20)。unlayered な `h2 { font: … }` に utilities では
          勝てないため、他の *-title 規則と同じ形に寄せている。 */}
      <h2 data-slot="subscription-section-title" className="text-foreground">
        {title}
      </h2>
      <div className="mt-4 lg:mt-6">{children}</div>
    </section>
  );
}

/** カードを縦に積む列 (PC gap24 / SP gap16)。 */
export function SubscriptionList({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="subscription-list" className="flex flex-col gap-4 lg:gap-6">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionStatusBadge — 状態バッジ (PC 6936:17639 / 6888:11790)             */
/* -------------------------------------------------------------------------- */

/**
 * 確定版の 3 状態のうち「解約済み」だけが DS の `Badge` (variant=secondary)
 * そのままで、契約中 / 一時停止中の 2 つは code 由来の instance
 * (`— (Proposed)`) で生の Tailwind パレット (green-50/700・yellow-50/700) を
 * 持っている。生カラー禁止なので 3 状態すべて DS `Badge` に寄せ、色は semantic
 * token だけで区別する。
 * - active    … `success` (肯定の意図は Figma の緑と同じ。文字は success-foreground
 *                で AA 合格域 = 実測 5.2:1)
 * - paused    … `outline` (薄い面 + 濃い文字 + 罫線。Figma の薄い chip に最も近い)
 * - cancelled … `muted` (いちばん静かな面 = 終わっているもの)
 *
 * Figma の解約済み (6888:11790) は DS `Badge variant=secondary` の実体だが、
 * `secondary` は**コード側で二重定義されていて実行時に金色 (#ffc200 / base.json 由来)
 * に解決する**ため使わない (getComputedStyle で確認済み)。是正は DS トークン整合
 * タスク 3b670c9d-064c-8166 側で、ここではトークンを触らない。代わりに意図が
 * いちばん近い `muted` を当てている。
 */
export function SubscriptionStatusBadge({
  kind,
  children,
}: {
  kind: SubscriptionStatusKind;
  children: React.ReactNode;
}) {
  if (kind === "active") {
    return (
      <Badge
        data-slot="subscription-status-badge"
        data-status="active"
        className="bg-success text-success-foreground"
      >
        {children}
      </Badge>
    );
  }

  if (kind === "cancelled") {
    return (
      <Badge
        data-slot="subscription-status-badge"
        data-status="cancelled"
        className="bg-muted text-muted-foreground"
      >
        {children}
      </Badge>
    );
  }

  return (
    <Badge
      data-slot="subscription-status-badge"
      data-status={kind}
      variant="outline"
    >
      {children}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionCardFrame — カードの器 (PC 6718:14888 / SP 6723:14796)            */
/* -------------------------------------------------------------------------- */

/**
 * 枠つきカード。DS の `Card` は rounded-xl (12) + shadow + py-6 / gap-6 で
 * 確定版 (rounded-lg 8 / 影なし / padding 24 均等) と寸法体系が違うため、
 * 上書きで戦わず専用の器にする (C5-1 の OrderSummary・C6-2 の AccountCta と同じ判断)。
 * 段間は Figma 実測どおり PC 16 / SP 12。
 */
export function SubscriptionCardFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      data-slot="subscription-card"
      className={cn(
        // `border` はTailwind v4では**太さだけ**で、色は currentColor に落ちる
        // (v3 の gray-200 既定は撤去された)。色クラスを付けないと罫線が本文色
        // (`foreground` #5d5e61) になり、Figma の #888675 とは別系統の濃さで出る。
        // DS の罫線トークンに束縛するため `border-border` を明示する
        // (`Badge variant=outline` など DS 側も同じ書き方)。
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-5 lg:gap-4 lg:p-6",
        className
      )}
    >
      {children}
    </article>
  );
}

/** カード最上段 — 状態バッジ + 右に次回お届け日 (PC 6718:14889 / SP 6723:14797)。 */
export function SubscriptionCardTopRow({
  badge,
  nextDelivery,
}: {
  badge: React.ReactNode;
  nextDelivery?: React.ReactNode;
}) {
  return (
    <div
      data-slot="subscription-card-top"
      className="flex items-center justify-between gap-4"
    >
      {badge}
      {nextDelivery ? (
        <p className={cn(captionClass, "shrink-0 text-muted-foreground")}>
          {nextDelivery}
        </p>
      ) : null}
    </div>
  );
}

/** 商品行の束 (溝 12)。 */
export function SubscriptionLines({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="subscription-lines" className="flex flex-col gap-3">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionLineRow — 商品 1 行 (PC 6718:14894 / SP 6723:14801)               */
/* thumb 48 (SP 44) / 溝 12 / 情報の行間 4 / 価格は右端                          */
/* -------------------------------------------------------------------------- */

/**
 * 行の横方向の分割は確定版の実測どおり **thumb + 12 + 商品情報 + 価格** で、
 * 商品情報と価格のあいだに溝は無い (Figma SP 6723:14801: 行 310 =
 * thumb 44 + 溝 12 + info 207 + 価格 47、info の右端 x263 と価格の左端 x263 が
 * 一致する。PC 6718:14894 も同じ分割で 1232 = 48 + 12 + info + 47)。
 *
 * よって商品情報カラムの幅は「行幅 − thumb − 12 − 価格幅」で決まる。ここに
 * 余分な溝を挟むとカラムが Figma より狭くなり、SP で折り返し行数が変わる
 * (旧実装は行に `gap-3` を持っており SP の商品情報が Figma 207 相当より 12px
 * 狭かった)。thumb と価格だけを `shrink-0` にして、商品情報は残りを取る
 * (= Figma の info と同じ挙動: PC は文字幅ぶんだけ使い、SP は上限で折り返す)。
 */

export function SubscriptionLineRow({
  title,
  meta,
  price,
  imageUrl,
  imageAlt,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  price: React.ReactNode;
  imageUrl?: string | null;
  imageAlt?: string;
}) {
  return (
    <div
      data-slot="subscription-line"
      className="flex items-center justify-between"
    >
      <div
        data-slot="subscription-line-left"
        className="flex min-w-0 items-center gap-3"
      >
        <div
          data-slot="subscription-line-thumb"
          className="relative size-11 shrink-0 overflow-hidden rounded-sm lg:size-12"
        >
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={imageAlt ?? ""}
              fill
              sizes="(min-width: 1024px) 48px, 44px"
              className="object-cover"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>
        <div
          data-slot="subscription-line-info"
          className="flex min-w-0 flex-col gap-1"
        >
          <p className={cn(bodySmClass, "text-foreground")}>{title}</p>
          {meta ? (
            <p className={cn(captionClass, "text-muted-foreground")}>{meta}</p>
          ) : null}
        </div>
      </div>
      {/* 金額は英数字なので CJK の行間 (1.8) ではなく Figma の en/body-sm
          (14 / lh 1.4 / tracking 0) に寄せる (C6-2 の PaymentMethodCard と同じ理由)。 */}
      <p
        data-slot="subscription-line-price"
        className="shrink-0 text-sm leading-[1.4] tracking-normal text-foreground"
      >
        {price}
      </p>
    </div>
  );
}

/** カード内の 12px 補足 (お届け頻度 / 末尾の注記)。 */
export function SubscriptionCardNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      data-slot="subscription-card-note"
      className={cn(captionClass, "text-muted-foreground", className)}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionPanel — カード内に開く操作パネル (PC 6719:14705 / 6719:14723)     */
/* -------------------------------------------------------------------------- */

/**
 * 「お届け頻度を変更」「解約」の 2 つの操作は、確定版では**カードの中に開く
 * パネル**として描かれる (Figma の「定期便の操作」節 6719:14702 は、その見た目を
 * 並べた注記フレーム。ページに常設の節ではない)。器はカードと同じ
 * (面 card / 枠 1px / 角丸 8 / padding 24・20) で、段間も同じ 16 / 12。
 */
export function SubscriptionPanel({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="subscription-panel"
      className={cn(
        // 罫線色は `border-border` を明示 (SubscriptionCardFrame と同じ理由)。
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-5 lg:gap-4 lg:p-6",
        className
      )}
    >
      {/* 体裁は globals.css の `h3[data-slot="subscription-panel-title"]` 規則
          (SP h5 14 → PC h4 16)。 */}
      <h3 data-slot="subscription-panel-title" className="text-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** パネル内の 12px 補足 (「新しいお届け頻度を選択」)。 */
export function SubscriptionPanelHint({ children }: { children: React.ReactNode }) {
  return (
    <p data-slot="subscription-panel-hint" className={cn(captionClass, "text-muted-foreground")}>
      {children}
    </p>
  );
}

/** パネル内の本文 (「本当に解約しますか？…」)。SP 14 / PC 14 (jp/body-sm)。 */
export function SubscriptionPanelBody({ children }: { children: React.ReactNode }) {
  return (
    <p data-slot="subscription-panel-body" className={cn(bodySmClass, "text-foreground")}>
      {children}
    </p>
  );
}

/** ボタンを並べる行 (溝 8・折り返しあり)。chips / actions 共通。 */
export function SubscriptionActionRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="subscription-action-row"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

/** 操作後のメッセージ (成功 = 既定色 / 失敗 = destructive)。14 (jp/body-sm)。 */
export function SubscriptionMessage({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <p
      data-slot="subscription-message"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        bodySmClass,
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* SubscriptionEmptyCard — 0 件のとき (PC 6720:9378 / SP 6723:14874)             */
/* -------------------------------------------------------------------------- */

export function SubscriptionEmptyCard({
  message,
  children,
}: {
  message: React.ReactNode;
  /** 「商品一覧」へ送るボタン (Figma 6887:11773)。 */
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="subscription-empty-card"
      /* 罫線色は `border-border` を明示 (SubscriptionCardFrame と同じ理由)。 */
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-5 py-8 text-center lg:px-6"
    >
      <p className={cn(BODY, "text-foreground")}>{message}</p>
      {children}
    </div>
  );
}

export { BODY as subscriptionBodyClass, CAPTION_TO_BODY_SM as subscriptionNoteClass };
