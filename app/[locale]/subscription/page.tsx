import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getProducts } from "@/lib/shopify";
import { Link } from "@/i18n/navigation";
import { ImageCard } from "@/components/media/image-card";
import { VariantSelector } from "@/components/product/variant-selector";
import { VariantPurchase } from "@/components/product/variant-purchase";
import { VariantSelectionProvider } from "@/components/product/variant-selection-context";
import { bodySmClass, captionClass, h4Class, overlineClass } from "@/components/editorial/rule-list";
import {
  Ledger,
  OpenFaqList,
  PageSection,
  SectionBody,
  SectionHead,
  SpecBand,
  StepCards,
  TripleColumn,
} from "@/components/editorial/section-blocks";
import { placeholderValue } from "@/lib/placeholders";
import { monthlyPriceLabel } from "@/lib/subscription-pricing";
import { cn } from "@/lib/utils";

/**
 * 定期便LP — Figma【R2: 確定版】(PC 8071:2 / SP 8073:2)。
 *
 * 構成案 v1 準拠。**購入導線は最下部 1 箇所だけ**で、CTA も 1 個。
 * 会員ランク・特典階層の要素は置かない (Figma の確定仕様)。上部の Hero CTA は
 * 購入ではなく最下部の申し込みブロックへのページ内アンカー。
 *
 * Figma 実測 (px) → 実装の対応:
 * - Hero        テキスト 600 / 写真 640 (grid 内)   → `lg:grid-cols-12` の 5 / 6
 * - DateRibbon  1312 × 49 の帯                        → `bg-muted` の pill
 * - 今月の3種   3列 416 gap32                          → `TripleColumn`
 * - 届くもの    4列 304 gap32                          → `SpecBand`
 * - 12ヶ月      2カラム台帳 (行 h48)                   → `Ledger`
 * - FAQ         アコーディオンなし・開いたまま          → `OpenFaqList`
 * - 申し込み    中央 528 幅・CTA 1 個                   → `max-w-132 mx-auto`
 *
 * 値の出どころ (messages/*.json は `{firstDelivery}` / `{monthlyPrice}` の差し込み口だけを持つ):
 * - **月額**: Shopify の selling plan が SoT。`lib/subscription-pricing.ts` が
 *   毎月お届けプランの継続価格を導出する (定数は置かない)
 * - **初回お届け日**: まだ事業側の確定待ち。Shopify の締日 (cutoff) / 起算日 (anchors) が
 *   未設定で導出できないため `lib/placeholders.ts` の仮当て値のまま。マーカーが残る間は
 *   production 相当のビルド / テストが機械的に落ちる。台帳は `docs/placeholders.md`
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscriptionR2");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const PLAN_ANCHOR = "plan";

/**
 * 事業側の確定待ちの仮当て値 (差し替え手順は lib/placeholders.ts)。
 *
 * 月額はここには無い。Shopify の selling plan を SoT にして毎リクエスト導出する
 * (`lib/subscription-pricing.ts`)。定数だと Shopify 側の価格改定が画面に出ず、
 * 表示額と請求額が食い違う。
 */
const FIRST_DELIVERY = placeholderValue("subscription.firstDeliveryDate");

/** 定期便商品を示す Shopify タグ。店舗側の表記は大文字始まり (`Subscription`)。 */
const SUBSCRIPTION_TAG = "subscription";

export default async function SubscriptionLPPage() {
  const t = await getTranslations("subscriptionR2");

  // 定期便商品 (sellingPlanGroups を持つ最初の 1 件) を実バックエンドから引く。
  let subscriptionProduct: Awaited<ReturnType<typeof getProducts>>["products"][number] | null =
    null;
  let detail: Awaited<ReturnType<typeof import("@/lib/shopify").getProductByHandle>> = null;
  try {
    const { getProductByHandle } = await import("@/lib/shopify");
    const res = await getProducts({ first: 20 });
    // タグは大小文字を区別せず照合する。店舗の実タグは `Subscription` で、
    // 完全一致だと定期便商品が 1 件も引けず月額が出なくなる。
    const candidate =
      res.products.find((p) =>
        p.tags?.some((tag) => tag.toLowerCase() === SUBSCRIPTION_TAG)
      ) ?? null;
    subscriptionProduct = candidate;
    if (candidate) {
      const full = await getProductByHandle(candidate.handle);
      detail = full && full.sellingPlanGroups.length > 0 ? full : null;
    }
  } catch {
    subscriptionProduct = null;
    detail = null;
  }

  // 月額 = 毎月お届けプランの継続価格 (初回特別価格ではない)。導出できないときは
  // 数字を出さず「準備中」の文言に落とす (古い定数を出すより安全)。
  const MONTHLY_PRICE = monthlyPriceLabel(detail) ?? t("monthlyPriceUnavailable");

  const boxItems = [1, 2, 3].map((n) => ({
    title: t(`box${n}Title`),
    body: t(`box${n}Body`),
  }));

  const includedItems = [1, 2, 3, 4].map((n) => ({
    term: t(`included${n}Term`),
    value: t(`included${n}Value`),
  }));

  const steps = [1, 2, 3, 4].map((n) => ({
    step: `0${n}`,
    name: t(`step${n}Name`),
    body: t(`step${n}Body`),
  }));

  const monthRows = Array.from({ length: 12 }, (_, i) => ({
    term: t(`month${i + 1}Term`),
    value: t(`month${i + 1}Value`),
  }));

  // 初回お届け日は仮当て値 (Shopify に締日・起算日が無く導出不能)。文言は messages 側、
  // 値は placeholders 側が持つ。
  const firstDeliveryRibbon = t("firstDeliveryRibbon", { firstDelivery: FIRST_DELIVERY });

  const priceItems = [1, 2, 3, 4].map((n) => ({
    term: t(`price${n}Term`),
    // {monthlyPrice} を使うのは price1Value だけ。未使用の値を渡しても無害。
    value: t(`price${n}Value`, { monthlyPrice: MONTHLY_PRICE }),
  }));

  const voiceItems = [1, 2, 3].map((n) => ({
    title: t(`voice${n}Title`),
    body: t(`voice${n}Body`),
  }));

  const faqItems = [1, 2, 3, 4, 5].map((n) => ({
    q: t(`faqQ${n}`),
    a: t(`faqA${n}`),
  }));

  const selectedVariant = detail?.variants[0] ?? null;

  return (
    <div data-slot="subscription-lp">
      {/* S1 Hero (Figma 8071:117) */}
      <PageSection data-slot="lp-hero" className="lg:py-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center lg:gap-8">
          <div className="lg:col-span-5">
            <p className={cn(overlineClass, "text-muted-foreground")}>{t("heroOverline")}</p>
            <h1 className="mt-5 lg:mt-6">{t("heroTitle")}</h1>
            <p className={cn(bodySmClass, "mt-5 max-w-120 text-muted-foreground lg:mt-8")}>
              {t("heroLead")}
            </p>
            <a
              href={`#${PLAN_ANCHOR}`}
              className={cn(
                bodySmClass,
                "mt-6 inline-flex h-11 items-center rounded-full border border-border px-8",
                "text-foreground transition-colors hover:bg-muted lg:mt-10"
              )}
            >
              {t("heroCta")}
            </a>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <ImageCard
              image={subscriptionProduct?.featuredImage?.url}
              alt={t("heroTitle")}
              aspectRatio="4/3"
            />
          </div>
        </div>
      </PageSection>

      {/* S2 初回お届け確定 (Figma 8071:125) */}
      <PageSection>
        <p
          data-slot="date-ribbon"
          className={cn(
            bodySmClass,
            /* 高さは Figma 実測 49 = padding 12 + body-sm 行ボックス 25.2 + padding 12。
             * min-h-11 (44) を固定していたため 5px 低かった (C3-2 QA 指摘)。 */
            "flex items-center rounded-full bg-muted px-8 py-3 text-foreground"
          )}
        >
          {firstDeliveryRibbon}
        </p>
        <SectionBody className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8">
          {[0, 1, 2].map((i) => (
            <ImageCard
              key={i}
              alt={firstDeliveryRibbon}
              aspectRatio="3/2"
            />
          ))}
        </SectionBody>
      </PageSection>

      {/* 今月の3種 (Figma 8071:132) */}
      <PageSection>
        <SectionHead overline={t("boxOverline")} title={t("boxTitle")} />
        <SectionBody>
          <TripleColumn items={boxItems} />
        </SectionBody>
      </PageSection>

      {/* 届くもの一式 (Figma 8071:149) */}
      <PageSection>
        <SpecBand items={includedItems} />
      </PageSection>

      {/* HowItWorks 4step (Figma 8071:164) */}
      <PageSection>
        <StepCards items={steps} className="lg:grid-cols-4" />
      </PageSection>

      {/* S3 語り (Figma 8071:181) — ボタンは置かない */}
      <PageSection>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <ImageCard alt={t("storyOverline")} aspectRatio="1/1" />
          </div>
          <div className="lg:col-span-6 lg:col-start-7 lg:self-center">
            <span aria-hidden="true" className="block h-px w-32 bg-border" />
            <p className={cn(captionClass, "mt-5 text-muted-foreground lg:mt-6")}>
              {t("storyOverline")}
            </p>
            <p className={cn(bodySmClass, "mt-5 text-foreground lg:mt-10")}>{t("storyBody")}</p>
          </div>
        </div>
      </PageSection>

      {/* 12ヶ月のリズム (Figma 8072:117) */}
      <PageSection>
        <SectionHead overline={t("monthsOverline")} />
        <SectionBody>
          <Ledger rows={monthRows} />
        </SectionBody>
      </PageSection>

      {/* S4 次月のお届け (Figma 8071:454) */}
      <PageSection>
        <h2>{t("nextMonthTitle")}</h2>
        <SectionBody className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <ImageCard alt={t("nextMonthTitle")} aspectRatio="13/9" />
          </div>
          <div className="lg:col-span-5 lg:col-start-7">
            <span
              data-slot="month-chip"
              className={cn(
                captionClass,
                "inline-flex h-9 items-center rounded-full bg-muted px-4 text-foreground"
              )}
            >
              {t("nextMonthChip")}
            </span>
            <p className={cn(bodySmClass, "mt-5 text-muted-foreground lg:mt-6")}>
              {t("nextMonthBody")}
            </p>
          </div>
        </SectionBody>
      </PageSection>

      {/* 料金と含まれるもの (Figma 8071:462) */}
      <PageSection>
        <SpecBand items={priceItems} />
      </PageSection>

      {/* つくり手の声 (Figma 8071:477) */}
      <PageSection>
        <SectionHead overline={t("voicesOverline")} title={t("voicesTitle")} />
        <SectionBody>
          <TripleColumn items={voiceItems} />
        </SectionBody>
      </PageSection>

      {/* よくある質問 (Figma 8071:494) */}
      <PageSection>
        <SectionHead overline={t("faqOverline")} />
        <SectionBody>
          <OpenFaqList items={faqItems} />
        </SectionBody>
      </PageSection>

      {/* プラン選択 + 購入導線 — 最下部のみ / CTA 1 個 (Figma 8071:514) */}
      <PageSection id={PLAN_ANCHOR} className="scroll-mt-24 bg-muted">
        <div className="mx-auto max-w-132 text-center">
          <p className={cn(h4Class, "text-foreground")}>
            {t("planLead", { monthlyPrice: MONTHLY_PRICE })}
          </p>

          {detail ? (
            /* 選択はブラウザ側で確定する (商品詳細と同じ入れ物)。
               ここは以前 `detail.variants[0]` を購入先に固定していたため、
               サイズやタイプを選び直しても投入される変種が変わらなかった。 */
            <VariantSelectionProvider
              options={detail.options}
              variants={detail.variants}
              initialSelection={{}}
            >
              <div className="mt-8 flex flex-col gap-6 text-left">
                <VariantSelector options={detail.options} />
                <VariantPurchase
                  sellingPlanGroups={detail.sellingPlanGroups}
                  productName={detail.title}
                />
              </div>
            </VariantSelectionProvider>
          ) : (
            <Link
              href="/products"
              className={cn(
                bodySmClass,
                "mt-8 inline-flex h-11 items-center rounded-full border border-border px-8",
                "text-foreground transition-colors hover:bg-background"
              )}
            >
              {t("planCta")}
            </Link>
          )}

          <p className={cn(captionClass, "mt-6 text-muted-foreground")}>{t("planNote")}</p>
        </div>
      </PageSection>
    </div>
  );
}
