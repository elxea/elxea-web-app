"use server";

import { cookies } from "next/headers";
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

export async function addItem(merchandiseId: string, quantity = 1) {
  const cartId = await getCartId();

  if (!cartId) {
    const cart = await createCart([{ merchandiseId, quantity }]);
    await setCartId(cart.id);
    return cart;
  }

  return addToCart(cartId, [{ merchandiseId, quantity }]);
}

export async function updateItem(
  lineId: string,
  merchandiseId: string,
  quantity: number
) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  if (quantity === 0) {
    return removeFromCart(cartId, [lineId]);
  }

  return updateCart(cartId, [{ id: lineId, merchandiseId, quantity }]);
}

export async function removeItem(lineId: string) {
  const cartId = await getCartId();
  if (!cartId) throw new Error("No cart found");

  return removeFromCart(cartId, [lineId]);
}
