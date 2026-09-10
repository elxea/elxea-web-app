"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { CupFeedbackCard } from "@/components/profile/cup-feedback-card";
import { RecipientCard } from "@/components/profile/recipient-card";
import type { AskableCup } from "@/lib/roji/issue-cups";

/**
 * 「今月のお茶」の問いを並べ、答え終わったものを畳む（顧客プロファイル 第1段 ①⑤）。
 *
 * 設計正本: rev.3.2 §2「『届いた後の2択』はどうやって届くか」の 2 本目の経路
 * （次に開いたとき、ページが 1 枚のカードを出す）。
 *
 * ## なぜここが client なのか
 *
 * 答えた札をその場で畳むためだけである。何を出すかを決めているのは**サーバ側**
 * （`pickAskableCups`）で、この層は判断を持たない。畳んだ状態は次に開いたときに
 * サーバ側の印（Firestore）から再現されるので、ここで持つのは 1 回の滞在ぶんの
 * 見え方だけ。
 */
export interface ThisMonthBoardProps {
  cups: AskableCup[];
  recipientOrder: { orderId: string; orderNumber: string } | null;
}

export function ThisMonthBoard({ cups, recipientOrder }: ThisMonthBoardProps) {
  const t = useTranslations("thisMonth");
  const [settledCups, setSettledCups] = useState<string[]>([]);
  const [settledOrders, setSettledOrders] = useState<string[]>([]);

  const settleCup = useCallback((productNo: string) => {
    setSettledCups((current) => [...current, productNo]);
  }, []);
  const settleOrder = useCallback((orderId: string) => {
    setSettledOrders((current) => [...current, orderId]);
  }, []);

  const openCups = cups.filter((cup) => !settledCups.includes(cup.productNo));
  const openOrder =
    recipientOrder && !settledOrders.includes(recipientOrder.orderId) ? recipientOrder : null;

  if (openCups.length === 0 && openOrder === null) {
    return (
      <p data-slot="this-month-empty" className="text-sm text-muted-foreground">
        {settledCups.length > 0 || settledOrders.length > 0 ? t("thanks") : t("nothingToAsk")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {openCups.map((cup) => (
        <CupFeedbackCard
          key={cup.productNo}
          productNo={cup.productNo}
          name={cup.name}
          issueRef={cup.issueRef}
          onSettled={settleCup}
        />
      ))}
      {openOrder && (
        <RecipientCard
          orderId={openOrder.orderId}
          orderNumber={openOrder.orderNumber}
          onSettled={settleOrder}
        />
      )}
    </div>
  );
}
