"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isProduction } from "@/lib/config";
import {
  createCart,
  addToCart,
  updateCart,
  removeFromCart,
} from "@/lib/shopify";

const CART_COOKIE = "shopify_cart_id";

async function getCartId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(CART_COOKIE)?.value;
}

async function setCartId(cartId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE, cartId, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
}

async function clearCartId() {
  const cookieStore = await cookies();
  cookieStore.delete(CART_COOKIE);
}

export async function addItem(merchandiseId: string, quantity = 1, sellingPlanId?: string) {
  const cartId = await getCartId();

  const line = sellingPlanId
    ? { merchandiseId, quantity, sellingPlanId }
    : { merchandiseId, quantity };

  if (!cartId) {
    const cart = await createCart([line]);
    if (!cart?.id) throw new Error("Failed to create cart");
    await setCartId(cart.id);
    revalidatePath("/", "layout");
    return cart;
  }

  try {
    const result = await addToCart(cartId, [line]);
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    // Cart may have expired or been deleted — create a fresh cart as fallback
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("カートは存在しません") || msg.includes("cart does not exist") || msg.includes("Cart add error")) {
      const cart = await createCart([line]);
      if (!cart?.id) throw new Error("Failed to create cart");
      await setCartId(cart.id);
      revalidatePath("/", "layout");
      return cart;
    }
    throw e;
  }
}

export async function updateItem(
  lineId: string,
  merchandiseId: string,
  quantity: number
) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  try {
    if (quantity === 0) {
      const result = await removeFromCart(cartId, [lineId]);
      revalidatePath("/", "layout");
      return result;
    }

    const result = await updateCart(cartId, [{ id: lineId, merchandiseId, quantity }]);
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    // Cart may have expired — clear the stale cart cookie so the next add creates a fresh cart
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("カートは存在しません") || msg.includes("cart does not exist")) {
      await clearCartId();
      revalidatePath("/", "layout");
      return null;
    }
    throw e;
  }
}

export async function removeItem(lineId: string) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  try {
    const result = await removeFromCart(cartId, [lineId]);
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    // Cart may have expired — clear the stale cart cookie
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("カートは存在しません") || msg.includes("cart does not exist")) {
      await clearCartId();
      revalidatePath("/", "layout");
      return null;
    }
    throw e;
  }
}
