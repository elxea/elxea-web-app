"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PURCHASE_SCENES, type PurchaseScene } from "@/lib/cdp/cup-feedback";
import { usePessimisticMutation } from "@/lib/interaction/use-optimistic-mutation";

/**
 * 「誰のために買ったか」を 1 注文ぶん聞く札（顧客プロファイル 第1段 ⑤）。
 *
 * 設計正本: rev.3.2 §6 第1段 ⑤ / §3「自分用と贈答は別モデル」/ §2 の表
 * 「購入完了後（**購入画面の外**）」。
 *
 * ## なぜ 2 択のままなのか
 *
 * 自分用と贈答は好みの強弱ではなく**構造が違う**（同じ人でも属性の重みが変わる）。
 * 3 つ目を足す種類の問いではないので、語彙 `PURCHASE_SCENES` は 2 値に閉じている。
 *
 * ## 1 注文につき 1 回
 *
 * 押した瞬間に送る（選んでから確定、の 2 手にしない）。2 択で取り消しの利く
 * 内容ではないぶん、手数を増やすほうが摩擦になる。訂正経路は第2段で置く。
 */
export interface RecipientCardProps {
  orderId: string;
  orderNumber: string;
  onSettled: (orderId: string) => void;
}

export function RecipientCard({ orderId, orderNumber, onSettled }: RecipientCardProps) {
  const t = useTranslations("thisMonth");
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PurchaseScene | null>(null);

  const submission = usePessimisticMutation<PurchaseScene>({
    operation: "purchase-recipient.submit",
    mutationClass: "pessimistic-form",
    send: async (scene) => {
      const res = await fetch("/api/user/purchase-recipient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scene }),
      });
      if (!res.ok) throw new Error(`purchase-recipient responded ${res.status}`);
      onSettled(orderId);
      return await res.json();
    },
    onFailure: () => {
      setChosen(null);
      setFailed(true);
    },
  });

  const { run } = submission;
  const choose = useCallback(
    (scene: PurchaseScene) => {
      setFailed(false);
      setChosen(scene);
      void run(scene);
    },
    [run],
  );

  return (
    <section
      data-slot="recipient-card"
      className="rounded-lg border border-border bg-background px-6 py-6 sm:px-8"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("recipientOverline")}
      </p>
      <h2 className="mt-2 text-lg">{t("recipientQuestion", { orderNumber })}</h2>
      <p className="mt-3 text-sm text-muted-foreground">{t("recipientWhy")}</p>

      <div className="mt-5 flex flex-wrap gap-3">
        {PURCHASE_SCENES.map((scene) => (
          <Button
            key={scene}
            variant={chosen === scene ? "default" : "outline"}
            data-slot="recipient-choice"
            data-pending={submission.isPending && chosen === scene ? "true" : undefined}
            disabled={submission.isPending}
            onClick={() => choose(scene)}
          >
            {submission.isPending && chosen === scene ? t("sending") : t(`recipient_${scene}`)}
          </Button>
        ))}
      </div>

      {failed && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t("sendFailed")}
        </p>
      )}
    </section>
  );
}
