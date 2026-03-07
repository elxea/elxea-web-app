import { cookies } from "next/headers";
import { CartProvider } from "./cart-context";
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

  return <CartProvider initialCart={cart}>{children}</CartProvider>;
}
