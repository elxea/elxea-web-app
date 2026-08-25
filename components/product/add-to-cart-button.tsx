"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useCart } from "@/components/cart/cart-context";
import { toast } from "sonner";

/**
 * AddToCartButton — 「カートに追加」。**押した瞬間に反応する**。
 *
 * ## 直したこと (監査 P1-1 / 2026-08-25)
 *
 * 以前は `await addToCart(...)` の**後**に知らせを出していた。2 個目以降は
 * 楽観更新が効くので 150ms で済むが、**1 個目だけは Shopify の cartCreate を
 * 伴う**ので本番実測 8.9 秒。その間に画面へ出ていたのは、ラベルが `...` に
 * 変わることだけだった (幅が縮むので、押せなくなったようにしか見えない)。
 *
 * いまは 3 つを押した瞬間に出す。
 *   - ヘッダーのバッジ (`cart-context` の仮カートで 1 個目も動く)
 *   - ボタン内の回転する印 + 「追加しています」(ラベルの幅を保つ)
 *   - 「カートに追加しました」のトースト (`viewCart` の導線つき)
 *
 * 送信が失敗したときだけ言い直す。ここは楽観更新と同じ約束で、
 * **先に見せて、外れたら直す**。
 */
export function AddToCartButton({
  merchandiseId,
  availableForSale,
  sellingPlanId,
  productName,
  price,
  currencyCode,
}: {
  merchandiseId: string;
  availableForSale: boolean;
  sellingPlanId?: string;
  productName?: string;
  price?: string;
  currencyCode?: string;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const { addToCart, isPending } = useCart();

  if (!availableForSale) {
    return (
      <button
        disabled
        className="w-full h-12 bg-muted text-muted-foreground text-[14px] font-medium cursor-not-allowed"
      >
        {t("soldOut")}
      </button>
    );
  }

  return (
    <button
      onClick={async () => {
        /* 送る前に知らせる。着地を待たないので、1 個目でも 8.9 秒待たされない。 */
        const pending = addToCart(merchandiseId, 1, sellingPlanId);
        toast(t("addedToCart"), {
          action: {
            label: t("viewCart"),
            onClick: () => router.push("/cart"),
          },
        });
        if ((await pending) === "failed") {
          toast.error(t("addToCartFailed"));
        }
      }}
      disabled={isPending}
      aria-busy={isPending}
      className="relative w-full h-12 border border-foreground bg-foreground text-background text-[14px] font-medium hover:bg-transparent hover:text-foreground transition-colors disabled:opacity-50"
    >
      {/* 進行の印は**絶対配置**。待機中の見た目 (中央寄せのラベル・高さ 48) を
          1px も動かさないまま、押した瞬間に回りはじめる。 */}
      {isPending && (
        <Loader2
          aria-hidden="true"
          className="absolute left-4 top-1/2 size-4 -translate-y-1/2 animate-spin"
        />
      )}
      {isPending ? t("addingToCart") : t("addToCart")}
    </button>
  );
}
