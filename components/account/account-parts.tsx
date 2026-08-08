import * as React from "react";
import Image from "next/image";

import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * マイページ (トップ) の DS 部品 —【R2: 確定版】(Figma 親 8095:731)。
 * PC 1440 `8095:733` / SP 375 `8095:792`。お支払い方法の節は PC `8144:1248`〜
 * `8144:1257` / SP `8145:1248`〜`8145:1257`。
 *
 * 確定版は「フルブリードの帯を縦に積む」構成で、帯ごとに上下余白が違う。
 * 帯の中身は `.page-container` (= 外余白 layout.grid.margin + 内容カラム
 * layout.container.xl) に収めるので、Header / Footer / 他ページと左端が揃う。
 * Figma のこのフレームは外余白 PC 64 / SP 16 で、トークン値と**一致する**
 * (カート C5-1 のような 80/20 の食い違いは無い)。
 *
 * Figma 実測 (px) → 実装:
 * - TitleBlock      PC pt40 / gap8 / pb24、SP pt24 / gap6 / pb16
 * - GreetingBand    PC py48 / gap8、SP py32 / gap6 (面は card)
 * - SectionHeader   PC pt40 / pb16、SP pt24 / pb12 (見出しと右リンクは baseline 揃え)
 * - カード列        PC gap32 / pb8、SP gap12 / pb8
 * - RecordCard      PC p20 / gap8 縦積み、SP p16 / 左 gap4 + 右に補足を寄せる
 * - ExpCard         PC 写真 160x120 / gap20、SP 写真 96x72 / gap16 (padding なし)
 * - PaymentCard     PC p20 / gap8 (枠 640x112)、SP p16 / gap8 (枠 343x104)
 * - AccountOpsBand  PC py40 横並び space-between、SP py32 / gap16 縦積み
 * - 角丸はすべて radius-sm (4) = Tailwind `rounded-sm`
 *
 * 文字組みは `typography.style.*` トークン (rule-list から再輸出した CSS 変数)、
 * 色は semantic token のみ。生 px・生カラーはこのファイルに書かない。
 */

/**
 * SP は caption (12 / 1.5) / PC は body-sm (14 / 1.8)。
 * 確定版は GreetingBand のリードと AccountOpsBand の本文でこの切り替えをする
 * (SP 8095:801 / 8095:851 は 12px、PC 8095:742 / 8095:788 は 14px)。
 */
const CAPTION_TO_BODY_SM = cn(
  captionClass,
  "lg:[font:var(--typography-style-body-sm)] lg:[letter-spacing:var(--typography-style-body-sm-tracking)]"
);

/* -------------------------------------------------------------------------- */
/* AccountTextLink — 節見出しの右に置く 12px の導線 (Figma 8095:737 / 8095:755)  */
/* -------------------------------------------------------------------------- */

export type AccountLink = {
  label: React.ReactNode;
  href: string;
  /** Shopify 顧客アカウントポータル等、アプリ外へ出るリンク。 */
  external?: boolean;
};

export function AccountTextLink({ label, href, external }: AccountLink) {
  const className = cn(
    captionClass,
    "shrink-0 text-muted-foreground transition-colors hover:text-foreground"
  );

  return external ? (
    <a data-slot="account-text-link" className={className} href={href}>
      {label}
    </a>
  ) : (
    <Link data-slot="account-text-link" className={className} href={href}>
      {label}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountTitleBlock — 主見出し + ログイン中の表示 (PC 8095:735 + 8095:738)      */
/* -------------------------------------------------------------------------- */

export function AccountTitleBlock({
  title,
  identity,
  action,
}: {
  title: React.ReactNode;
  identity?: React.ReactNode;
  /** PC のみ表示 (SP の TitleBlock 8095:796 はリンクを持たない)。 */
  action?: AccountLink;
}) {
  return (
    <div
      data-slot="account-title-block"
      className="page-container flex flex-col gap-1.5 pt-6 pb-4 lg:gap-2 lg:pt-10 lg:pb-6"
    >
      <div className="flex items-baseline justify-between gap-6">
        {/* 主見出しは全体裁定どおり PC 44 (display トークン) / SP 32。 */}
        <h1 className="page-title text-foreground">{title}</h1>
        {action ? (
          <div className="hidden lg:block">
            <AccountTextLink {...action} />
          </div>
        ) : null}
      </div>
      {identity ? (
        <p className={cn(captionClass, "text-muted-foreground")}>{identity}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountGreetingBand — 面つきの挨拶帯 (PC 8095:740 / SP 8095:799)             */
/* -------------------------------------------------------------------------- */

export function AccountGreetingBand({
  greeting,
  lead,
}: {
  greeting: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div data-slot="account-greeting-band" className="bg-card">
      <div className="page-container flex flex-col gap-1.5 py-8 lg:gap-2 lg:py-12">
        {/* 見出し要素ではなく本文 (挨拶) なので p。体裁だけ h1 トークン
            (32 / Light / lh 1.2 = Figma jp/h1) に合わせる。値は globals.css の
            `p[data-slot="account-greeting"]` 規則 (h1 トークン + lh 1.2) から来る。
            utilities では font shorthand と leading の適用順を制御できず lh が
            cjk 値 1.4 になってしまうため、他の *-title 規則と同じ形に寄せた。 */}
        <p data-slot="account-greeting" className="text-foreground">
          {greeting}
        </p>
        {lead ? (
          <p className={cn(CAPTION_TO_BODY_SM, "text-muted-foreground")}>{lead}</p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountSectionHeader — 節見出し + 右リンク (PC 8095:753 / SP 8095:812)        */
/* -------------------------------------------------------------------------- */

export function AccountSectionHeader({
  title,
  action,
}: {
  title: React.ReactNode;
  action?: AccountLink;
}) {
  return (
    <div
      data-slot="account-section-header"
      className="page-container flex items-baseline justify-between gap-4 pt-6 pb-3 lg:pt-10 lg:pb-4"
    >
      {/* Figma の節見出しは 16 / 500 (jp/h4)。要素は文書構造上 h2 のままで、
          体裁は globals.css の `h2[data-slot="shelf-title"]` 規則 (h4 トークン)
          を再利用する (ジャーナル:カテゴリの棚見出しと同じ扱い)。 */}
      <h2 data-slot="shelf-title" className="text-foreground">
        {title}
      </h2>
      {action ? <AccountTextLink {...action} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountCardGrid — カード列 (PC 3列/2列 gap32 / SP 縦積み gap12)              */
/* -------------------------------------------------------------------------- */

export function AccountCardGrid({
  columns = 3,
  className,
  children,
}: {
  /** PC のカラム数。これから / これまで = 3 (416px)、続き / 支払方法 = 2 (640px)。 */
  columns?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="account-card-grid"
      className={cn(
        "page-container grid grid-cols-1 gap-3 pb-2 lg:gap-8",
        columns === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountRecordCard — 写真なしカード (PC 8095:757 / SP 8095:816)               */
/* PC は 3 行縦積み / SP は「左に日付+見出し・右に補足」の 1 行。                */
/* -------------------------------------------------------------------------- */

export function AccountRecordCard({
  meta,
  title,
  note,
  href,
}: {
  meta?: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
  href?: string;
}) {
  const className =
    "flex items-center justify-between gap-4 rounded-sm bg-card p-4 lg:flex-col lg:items-start lg:gap-2 lg:p-5";

  /* SP は日付 + 見出しを 1 かたまり (gap4) にして右の補足と向き合わせる。
     PC は `lg:contents` でこのラッパを消し、3 つの行をカード直下の縦積み
     (gap8) に戻す。同じ内容を 2 回描かない (hidden による二重描画をしない)。 */
  const body = (
    <>
      <div className="flex min-w-0 flex-col gap-1 lg:contents">
        {meta ? (
          <p className={cn(captionClass, "text-muted-foreground")}>{meta}</p>
        ) : null}
        <p className={cn(bodySmClass, "text-foreground")}>{title}</p>
      </div>
      {note ? (
        <p className={cn(captionClass, "shrink-0 text-muted-foreground")}>{note}</p>
      ) : null}
    </>
  );

  return href ? (
    <Link data-slot="account-record-card" href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div data-slot="account-record-card" className={className}>
      {body}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountExpCard — 写真つきカード (PC 8095:777 / SP 8095:840)                   */
/* -------------------------------------------------------------------------- */

export function AccountExpCard({
  label,
  title,
  imageUrl,
  imageAlt,
  href,
}: {
  label?: React.ReactNode;
  title: React.ReactNode;
  imageUrl?: string | null;
  imageAlt?: string;
  href?: string;
}) {
  const className =
    "flex items-center gap-4 overflow-hidden rounded-sm bg-card lg:gap-5";

  const body = (
    <>
      {/* 写真は 4:3 (SP 96x72 / PC 160x160*0.75=120)。カードに padding は無く、
          写真がカードの左端・上下端に接する (Figma 8095:778 は x0 y0)。 */}
      <div className="relative h-18 w-24 shrink-0 overflow-hidden lg:h-30 lg:w-40">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt ?? ""}
            fill
            sizes="(min-width: 1024px) 160px, 96px"
            className="object-cover"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 pr-4 lg:pr-5">
        {label ? (
          <p className={cn(captionClass, "text-muted-foreground")}>{label}</p>
        ) : null}
        <p className={cn(bodySmClass, "text-foreground")}>{title}</p>
      </div>
    </>
  );

  return href ? (
    <Link data-slot="account-exp-card" href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div data-slot="account-exp-card" className={className}>
      {body}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountPaymentMethodCard — ご登録のカード (PC 8144:1252 / SP 8145:1252)       */
/* 変更操作の UI は持たない (確定版は節見出しの外部リンク 1 本だけ)。            */
/* -------------------------------------------------------------------------- */

export function AccountPaymentMethodCard({
  label,
  brand,
  masked,
  note,
}: {
  label: React.ReactNode;
  /** カードブランド (例: VISA)。 */
  brand: React.ReactNode;
  /** 下 4 桁のマスク表記 (例: •••• 1234)。生の番号は扱わない。 */
  masked: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div
      data-slot="account-payment-method-card"
      className="flex flex-col gap-2 rounded-sm bg-card p-4 lg:p-5"
    >
      <p className={cn(overlineClass, "text-muted-foreground")}>{label}</p>
      {/* ブランドと下 4 桁は英数字なので、CJK の行間 (1.8) ではなく Figma の
          en/body-sm (14 / lh 1.4 / tracking 0) に合わせる。カートの英字リードと
          同じ理由 (要素に lang を付けても CSS 変数は html から継承されるため、
          font shorthand を使わず個別指定にする)。 */}
      <div className="flex items-center gap-3 text-sm leading-[1.4] tracking-normal text-foreground">
        <span>{brand}</span>
        <span>{masked}</span>
      </div>
      {note ? (
        <p className={cn(captionClass, "text-muted-foreground")}>{note}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountOpsBand + AccountCta — 末尾の案内帯 (PC 8095:787 / SP 8095:850)        */
/* -------------------------------------------------------------------------- */

export function AccountCta({ label, href, external }: AccountLink) {
  /* Figma の CTA は 高さ 49 (= py12 + 14/1.8) / radius-sm (4) / px20 で、DS の
     Button (h-9 / rounded-md / px-4) とは寸法体系が違う。Button を上書きして
     戦うより専用部品にする (C5-1 の OrderSummary ボタンと同じ判断)。 */
  const className = cn(
    bodySmClass,
    "shrink-0 rounded-sm bg-primary px-5 py-3 text-primary-foreground transition-opacity hover:bg-primary/90"
  );

  return external ? (
    <a data-slot="account-cta" className={className} href={href}>
      {label}
    </a>
  ) : (
    <Link data-slot="account-cta" className={className} href={href}>
      {label}
    </Link>
  );
}

export function AccountOpsBand({
  note,
  children,
}: {
  note: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div data-slot="account-ops-band" className="bg-card">
      <div className="page-container flex flex-col items-start gap-4 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-10">
        <p className={cn(CAPTION_TO_BODY_SM, "text-foreground")}>{note}</p>
        {children}
      </div>
    </div>
  );
}
