import { env } from "@/lib/config";

/**
 * マイページから外へ出る導線 (Shopify 顧客アカウントポータル)。
 *
 * roji 側にお届け先 (住所) / お支払い方法 / 注文明細の編集 UI は持たない。
 * 【R2: 確定版】マイページ (Figma 8095:731) がその 3 つを「外部リンク 1 本」に
 * 寄せているため (PC TitleRow 8095:737「設定・契約 →」/ お支払い方法の節見出し
 * 8144:1250「お支払い方法を変更する →」/ AccountOpsBand 8095:788 の本文)。
 *
 * URL は Shopify の新カスタマーアカウントの正規形
 * `https://shopify.com/<shop_id>/account` を組み立てる。`lib/shopify/customer.ts`
 * の Customer Account API も同じ `SHOPIFY_SHOP_ID` から
 * `https://shopify.com/<shop_id>/account/customer/api/...` を作っており、出どころは
 * 同じ 1 つの環境変数。vanity ドメイン (account.elxea.com) を焼き込まないのは、
 * テストストアだと vanity が無いため (customer.ts の同じ注記を参照)。
 *
 * 実行環境で解決できないとき (SHOPIFY_SHOP_ID 未設定) は null を返し、呼び出し側は
 * リンクを描かない。存在しない URL を指すリンクは出さない。
 */
export function customerAccountPortalUrl(): string | null {
  const override = env("SHOPIFY_CUSTOMER_ACCOUNT_PORTAL_URL");
  if (override) return override;

  const shopId = env("SHOPIFY_SHOP_ID");
  if (!shopId) return null;

  return `https://shopify.com/${shopId}/account`;
}
