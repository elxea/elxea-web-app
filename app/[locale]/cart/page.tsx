import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { CartContent } from "@/components/cart/cart-content";
import { Section } from "@/components/layout/container";
import { bodySmClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("cart"),
  };
}

/**
 * カート /ja/cart —【R2: 確定版】カート 変A（部品ベース）
 * PC 6684:8698 / SP 6686:14177 (section 6679:14041)。
 *
 * Figma 実測 (px) → 実装:
 * - 面の上下余白  PC 96/96、SP 40/64             → `pt-10 pb-16 lg:py-24`
 * - 見出し → 明細  PC 64、SP 40                  → `gap-10 lg:gap-16`
 * - CartHeader 内 gap 8                          → `gap-2`
 * - 主見出し「カート」 PC 44 / SP 32 (Light / lh 1.2)
 *   → `.page-title` (md+ で display トークン 44px / lh 1.2、SP は base h1 32px)。
 *     44px は全体裁定どおりで、他の R2 ページ主見出しと同一実装。
 * - リード「Items in your cart」 14 / 400 / muted → `body-sm` トークン
 *
 * 横幅は `Section width="wide"` (= `.page-container` / 内容 1312 + 外余白 64)。
 * Figma のこのフレームは外余白 80 / 内容 1280 だが、外余白は Foundations の
 * `layout.grid.margin.desktop` (64) に束縛され、Header / Footer / 全ページの左端が
 * 同じトークンを解決する設計になっている (design-kit conflicts[c-04] / [c-11])。
 * カート 1 ページのために 80 を焼き込むと全画面の左端が揃わなくなるため既存
 * トークンに従う。詳細は docs/fidelity/c5-1-fidelity.md の【仕様】欄。
 */
export default function CartPage() {
  const t = useTranslations("common");
  const tc = useTranslations("cart");

  return (
    <Section width="wide" spacing="none" className="pt-10 pb-16 lg:py-24">
      <div className="flex flex-col gap-10 lg:gap-16">
        <div data-slot="cart-header" className="flex flex-col gap-2">
          <h1 className="page-title text-foreground">{t("cart")}</h1>
          <p className={cn(bodySmClass, "text-muted-foreground")}>{tc("subtitle")}</p>
        </div>
        <CartContent />
      </div>
    </Section>
  );
}
