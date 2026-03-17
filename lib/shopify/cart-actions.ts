"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
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

  const result = await addToCart(cartId, [line]);
  revalidatePath("/", "layout");
  return result;
}

export async function updateItem(
  lineId: string,
  merchandiseId: string,
  quantity: number
) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  if (quantity === 0) {
    const result = await removeFromCart(cartId, [lineId]);
    revalidatePath("/", "layout");
    return result;
  }

  const result = await updateCart(cartId, [{ id: lineId, merchandiseId, quantity }]);
  revalidatePath("/", "layout");
  return result;
}

export async function removeItem(lineId: string) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  const result = await removeFromCart(cartId, [lineId]);
  revalidatePath("/", "layout");
  return result;
}
