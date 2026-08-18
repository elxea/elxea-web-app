import { cookies } from "next/headers";
import { CartProvider } from "./cart-context";
import { seedCart } from "@/lib/preview-seed";
import type { Cart } from "@/lib/shopify/types";

async function getInitialCart(): Promise<Cart | null> {
  const cookieStore = await cookies();
  const cartId = cookieStore.get("shopify_cart_id")?.value;
  if (!cartId) return null;

  try {
    const { getCart } = await import("@/lib/shopify");
    return await getCart(cartId);
  } catch {
    return null;
  }
}

export async function CartProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const cart = await getInitialCart();

  /* 実カートが無いときだけ、プレビュー専用の見本カートを流す (PREVIEW_SEED=1)。
   * フラグ未設定時 (production / Vercel Preview の既定) は seedCart() が null を
   * 返すので挙動は見本導入前と byte-identical。Shopify へは書き込まない。
   * 目的は /ja/cart の確定版レイアウトを実寸計測できる状態を作ること。 */
  return <CartProvider initialCart={cart ?? seedCart()}>{children}</CartProvider>;
}
