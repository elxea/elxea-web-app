import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { CartContent } from "@/components/cart/cart-content";
import { Section } from "@/components/layout/container";

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
          {/* Figma 6684:122 のリードは `elxea/body-sm` = Inter 14 / lh 21 (= 1.5) /
              tracking 5%。`typography.style.body-sm` の base 値 (14 / 1.5 / .05em) と
              一致するが、ページが `:lang(ja)` なので dist/tokens-cjk.css の再束縛
              (lh 1.8 = 25.2px) がカスタムプロパティ継承で効いてしまう (要素に
              `lang="en"` を付けても変数は html から継承されるので戻らない)。
              英字リードに CJK の行間を当てるのは誤りなので、font shorthand を使わず
              `text-sm/normal` (14px / 1.5 = 21px) で Figma 値に合わせる。共有トークンは
              動かさない (同種の cjk スコープ問題は rule-list の overline に既知として
              記録済み)。`lang="en"` は読み上げ用に付ける。 */}
          <p lang="en" className="text-muted-foreground text-sm/normal">
            {tc("subtitle")}
          </p>
        </div>
        <CartContent />
      </div>
    </Section>
  );
}
