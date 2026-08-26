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
 *
 * ## 押せなくするのをやめた (Setaka 実機指摘 2026-08-26)
 *
 * 上の直しを入れてもなお「2 秒かかる」と感じられていた。実測すると、バッジは
 * **72ms** で動いていたのに、ボタンは押した直後から **2,561ms** のあいだ
 * `disabled` だった (本番 SP390 / 2026-08-26)。つまり待たせていたのは送信では
 * なく**受付**で、2 個目を入れようとした指は無言で弾かれていた。
 *
 * いまは `disabled` を外し、進行は回転する印と `aria-busy` だけで名乗る。
 * 2 個ほしい人が 2 回押せば 2 個入る (`addItem` は同じ行があれば数量を足すので、
 * 続けて押しても数が壊れない)。**在庫切れのときだけ**は押せないままにする —
 * あれは「進行中」ではなく「そもそも買えない」という別の意味だから。
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
