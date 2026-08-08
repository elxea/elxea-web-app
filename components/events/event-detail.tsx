/**
 * イベント詳細の共有 DS 部品。
 *
 * Figma【R2: 確定版】file `AWLnI0XF07e8rScuxPYPc7`
 * - section 6657:7931「イベント詳細 変A（部品ベース）— PC/SP @/ja/events/[slug]」
 * - PC frame 6657:7932 (1440x2005) / SP frame 6662:8160 (390x1919)
 *
 * 実測値 (PC / SP)。数値はすべて spacing トークン刻みで、生 px は書かない:
 * - Event Content   px は `.page-container` (外余白トークン) / pt 48 / 16、pb 96 / 48、節間 gap 64 / 40
 * - Event Header    6657:13352 / 6663:8166   gap 24 / 20
 * - eyebrow         gap 12、「Event」14px medium muted、Badge「会員限定」
 * - 日時・開催地 card 6658:13324 / 6663:8172  bg card / border 1px / radius-lg 8 / p 24 / 20、gap 16
 * - Hero            6659:8002 / 6664:8160     1280x560 (16:7) / 358x240 (3:2)
 * - Registration    6660:8002 / 6664:8163     card 外殻、p 24 / 20、gap 16 / 12
 * - Body            6661:13490 / 6664:8168    gap 16、見出し 24 / 20、詳細リンク h43
 *
 * 節の中身が無いときは枠ごと出さない (空枠を出さない方針 — C4-2 PDP 読みもの /
 * C4-3 プレイリスト詳細と同じ)。判断は各 export の呼び出し側で行う。
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Section } from "@/components/layout/container";

/**
 * ページ枠。
 *
 * Figma は Event Content 6657:7969 / 6662:8167。外余白は Figma 実測 (PC 80 /
 * SP 16) のうち SP は DS の `layout.grid.margin.mobile` と一致し、PC は既知差分
 * (design-kit conflicts[c-04] / PC 80 vs 64) なのでトークン側に従う
 * (C5-1 カートと同じ判断。ページ 1 枚のために全画面の左端を崩さない)。
 */
function EventDetailPage({
  children,
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <Section
      spacing="none"
      data-slot="event-detail-page"
      className={cn("pt-4 pb-12 md:pt-12 md:pb-24", className)}
      {...props}
    >
      {children}
    </Section>
  );
}

/** 節を積む縦列 (Figma の節間 gap 64 / 40)。 */
function EventDetailStack({ children, className }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="event-detail-stack"
      className={cn("flex flex-col gap-10 md:gap-16", className)}
    >
      {children}
    </div>
  );
}

/** 見出しブロック (Figma Event Header 6657:13352 / 6663:8166)。 */
function EventDetailHeader({ children, className }: React.ComponentProps<"div">) {
  return (
    <header
      data-slot="event-detail-header"
      className={cn("flex flex-col gap-5 md:gap-6", className)}
    >
      {children}
    </header>
  );
}

/**
 * キッカー行 (Figma eyebrow 6657:13353 / 6663:8167)。
 * 「Event」+ 会員限定バッジ。バッジは DS の Badge secondary をそのまま使う
 * (Figma は radius-lg 8 だが DS Badge は rounded-full。DS 全体に効く角丸の
 * 食い違いなので本レーンでは直さない — 忠実度対比表の【DS案件】参照)。
 */
function EventEyebrow({
  label,
  badge,
}: {
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <div
      data-slot="event-eyebrow"
      className="flex items-center gap-3 text-sm leading-5 font-medium text-muted-foreground"
    >
      <span>{label}</span>
      {badge ? <Badge variant="secondary">{badge}</Badge> : null}
    </div>
  );
}

/**
 * ページ主見出し。
 *
 * Figma はこの画面だけ PC 36 / SP 30 だが、「ページ主見出しは 44px display」の
 * 全体裁定に合わせて既存の `.page-title` (SP 32 / PC 44) を使う
 * (一覧・他の詳細ページと同じクラス。ページ別の見出しスケールを増やさない)。
 */
function EventDetailTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="page-title">{children}</h1>;
}

/** 日時・開催地カード (Figma 6658:13324 / 6663:8172)。 */
function EventFactCard({ children, className }: React.ComponentProps<"div">) {
  return (
    <dl
      data-slot="event-fact-card"
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-card p-5 md:p-6",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/**
 * カード内の 1 行 (Figma row 日時 6658:13325 / row 開催地 6658:13329)。
 * ラベル 14px muted 左 / 値 右寄せ (PC 16px / SP 14px)。
 */
function EventFactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="event-fact-row"
      className="flex items-center justify-between gap-4"
    >
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground md:text-base">
        {children}
      </dd>
    </div>
  );
}

/** 行間の罫線 (Figma divider 6658:13328 / 6663:8176)。 */
function EventFactDivider() {
  return <Separator data-slot="event-fact-divider" />;
}

/**
 * 主画像 (Figma Hero (ImageWithFallback) 6659:8002 / 6664:8160)。
 * 比率は PC 1280x560 = 16:7 / SP 358x240 = 3:2。角丸は Figma に無い。
 * 代替画像も Figma の指定 (/placeholder-hero-approach.jpg) に合わせる。
 */
function EventHero({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      data-slot="event-hero"
      className="relative aspect-3/2 w-full overflow-hidden md:aspect-16/7"
    >
      <ImageWithFallback
        src={src}
        fallbackSrc="/placeholder-hero-approach.jpg"
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 1280px"
        className="object-cover"
        priority
      />
    </div>
  );
}

/**
 * 参加登録カード (Figma Registration 6660:8002 / 6664:8163)。
 * 中身は「全幅 CTA → 会員限定の注記 → (権限が無いときのみ) MemberGate」。
 * Figma の 6660:8006 (12px) は実装向けのデザイン注記なので文言としては出さない。
 */
function EventRegistrationCard({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="event-registration-card"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-5 md:gap-4 md:p-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** 登録カード内の注記 (Figma 6660:8005 / 6664:8166)。 */
function EventRegistrationNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-slot="event-registration-note"
      className="text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

/** 本文節 (Figma Body 6661:13490 / 6664:8168)。 */
function EventBody({ children, className }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="event-body"
      className={cn("flex flex-col gap-4", className)}
    >
      {children}
    </div>
  );
}

/**
 * 本文節の見出し (Figma 6661:13491 / 6664:8169)。
 * Figma は PC 24 / SP 20 の weight 500。`h2 { font: … }` は unlayered なので
 * Tailwind utilities では上書きできず、`app/globals.css` の
 * `h2[data-slot="event-section-title"]` (unlayered) で体裁を当てている
 * (`section-title` / `summary-title` と同じ作法)。
 */
function EventBodyHeading({ children }: { children: React.ReactNode }) {
  return <h2 data-slot="event-section-title">{children}</h2>;
}

/**
 * 詳細・申し込みページへの外部リンク (Figma 詳細リンク 6661:13493 / 6664:8171)。
 * 罫線 + 面と同じ高さ (h43 = `size="cta"`) で、SP は全幅・PC は内容幅。
 * Figma の末尾グリフ「↗」はそのまま文字として置く (アイコン化すると 16px の
 * 字面と揃わないため。Figma も text ノード 6661:13495)。
 */
function EventDetailsLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="cta"
      data-slot="event-details-link"
      // `border-border` を明示するのは、shadcn の outline variant が幅だけ指定で
      // 色は currentColor になり、Figma の罫線 (border #888675) より濃く出るため
      // (実測: 未指定だと foreground #5d5e61 で描かれる)。
      className="w-full self-start border-border px-5 md:w-auto"
      asChild
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span aria-hidden="true">↗</span>
      </a>
    </Button>
  );
}

export {
  EventBody,
  EventBodyHeading,
  EventDetailHeader,
  EventDetailPage,
  EventDetailStack,
  EventDetailTitle,
  EventDetailsLink,
  EventEyebrow,
  EventFactCard,
  EventFactDivider,
  EventFactRow,
  EventHero,
  EventRegistrationCard,
  EventRegistrationNote,
};
