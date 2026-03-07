import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: currencyCode,
  }).format(parseFloat(amount));
}
