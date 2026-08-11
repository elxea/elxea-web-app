"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  SubscriptionActionRow,
  SubscriptionMessage,
  SubscriptionPanel,
  SubscriptionPanelBody,
  SubscriptionPanelHint,
} from "@/components/account/subscription-parts";
import { Button } from "@/components/ui/button";
import {
  frequencyOptionKey,
  isSameFrequency,
  STALE_BILLING_CYCLE_VIEW,
  type FrequencyOption,
} from "@/lib/subscription-view";
import {
  pauseSubscriptionAction,
  activateSubscriptionAction,
  cancelSubscriptionAction,
  skipNextDeliveryAction,
  changeDeliveryFrequencyAction,
} from "@/lib/shopify/subscription-actions";

/**
 * 定期便カードの操作 —【R2: 確定版】(Figma PC 6717:14527 / SP 6723:14747)。
 *
 * 確定版の操作は 2 層になっている:
 *   1. カード内のボタン列 — 次回をスキップ (ghost) / 一時停止 (outline) /
 *      お届け頻度を変更 (outline) / 解約する (destructive)。
 *      一時停止中は「再開」(塗り) 1 個だけ (Figma 6718:14902)。
 *   2. カード内に開くパネル — 「お届け頻度を変更」(6719:14705) と
 *      「解約」(6719:14723)。Figma の「定期便の操作」節はこのパネルの見た目を
 *      並べた注記フレームで、ページ常設の節ではない。
 *
 * 解約は**必ず 2 段**にする (ボタン → 確認パネルの「本当に解約する」)。確定版が
 * その形 (6719:14725「本当に解約しますか？この操作は取り消せません。」) を持っている。
 *
 * Server Action (`lib/shopify/subscription-actions`) の呼び方は C5-0 の確定形の
 * まま変えない。所有者照合・billingCycle の実データ解決はすべてサーバ側にある。
 */

export type SubscriptionActionLabels = {
  skipNext: string;
  changeFrequency: string;
  pauseSubscription: string;
  cancelSubscription: string;
  cancelPanelTitle: string;
  cancelConfirmBody: string;
  confirmCancel: string;
  resumeSubscription: string;
  selectFrequency: string;
  cancel: string;
  actionError: string;
  /** 見ていた画面が古くてスキップを中止したときの案内。 */
  staleViewError: string;
  frequencyChanged: string;
  frequencyChangeError: string;
  previewNotice: string;
  frequencyOptionLabels: Record<string, string>;
};

type PanelKind = "frequency" | "cancel" | null;

export function SubscriptionActions({
  contractId,
  kind,
  nextBillingDate,
  currentInterval,
  currentIntervalCount,
  frequencyOptions,
  labels,
  preview = false,
}: {
  contractId: string;
  /** 表示モデルの状態 (active / paused)。cancelled では描画しない。 */
  kind: "active" | "paused";
  /**
   * この画面が表示しているお届け予定日。スキップ操作でサーバへ渡し、
   * 「顧客が狙った周期」と「サーバが解決した次の周期」が一致するかの照合に使う。
   * 別タブ・リロード後の再実行で 2 周期目まで飛ぶのを防ぐためのもので、
   * 周期を指定する手段ではない (サーバは常に自分で解決する)。
   */
  nextBillingDate: string | null;
  currentInterval?: string;
  currentIntervalCount?: number;
  /**
   * 選べるお届け頻度。Shopify に実在する selling plan からサーバ側で導出した
   * ものだけを受ける (`lib/subscription-frequencies.server.ts`)。ここで固定の
   * 一覧を持たないのが要点で、実在しないプランを提示して必ず失敗させないため。
   */
  frequencyOptions: FrequencyOption[];
  labels: SubscriptionActionLabels;
  /**
   * 計測用の見本 (PREVIEW_SEED=1) のとき true。見本の契約は Shopify に存在しない
   * ため、Server Action を**一度も呼ばない**。実契約へ誤って mutation が飛ぶ経路を
   * 作らないためのガード (押しても案内を出すだけ)。
   */
  preview?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelKind>(null);

  function resetMessages() {
    setError(null);
    setSuccessMessage(null);
  }

  function togglePanel(next: Exclude<PanelKind, null>) {
    resetMessages();
    setOpenPanel((current) => (current === next ? null : next));
  }

  /**
   * 切り替え先が 1 つも無い (ストアのプランが 1 種類だけ / 読めなかった) ときは
   * 「お届け頻度を変更」を出さない。押しても現在値しか並ばないパネルが開くだけで、
   * 顧客には行き止まりに見えるため。
   */
  const canChangeFrequency = frequencyOptions.some(
    (option) => !isSameFrequency(option, currentInterval, currentIntervalCount)
  );

  function handleAction(action: "pause" | "activate" | "cancel" | "skip") {
    resetMessages();

    if (preview) {
      setSuccessMessage(labels.previewNotice);
      return;
    }

    startTransition(async () => {
      let result: { success: boolean; error?: string } | undefined;
      switch (action) {
        case "pause":
          result = await pauseSubscriptionAction(contractId);
          break;
        case "activate":
          result = await activateSubscriptionAction(contractId);
          break;
        case "cancel":
          result = await cancelSubscriptionAction(contractId);
          break;
        case "skip":
          // 画面が見せているお届け予定日を一緒に渡す。サーバはこれと自分で解決した
          // 周期が食い違ったら何もしない (別タブ・リロード後の再実行で 2 周期目まで
          // 飛ぶのを防ぐ)。
          result = await skipNextDeliveryAction(contractId, nextBillingDate);
          break;
      }

      if (result && !result.success) {
        // 「見ていた画面が古い」は機械可読コードで返る。顧客には何をすれば
        // よいか (再読み込み) が分かる案内に差し替える。
        setError(
          result.error === STALE_BILLING_CYCLE_VIEW
            ? labels.staleViewError
            : (result.error ?? labels.actionError)
        );
        return;
      }
      setOpenPanel(null);
      router.refresh();
    });
  }

  function handleFrequencyChange(option: FrequencyOption) {
    if (isSameFrequency(option, currentInterval, currentIntervalCount)) return;
    resetMessages();

    if (preview) {
      setSuccessMessage(labels.previewNotice);
      return;
    }

    startTransition(async () => {
      const result = await changeDeliveryFrequencyAction(
        contractId,
        option.interval,
        option.intervalCount
      );

      if (result.success) {
        setOpenPanel(null);
        setSuccessMessage(labels.frequencyChanged);
        router.refresh();
        return;
      }
      setError(result.error ?? labels.frequencyChangeError);
    });
  }

  return (
    <>
      <SubscriptionActionRow>
        {kind === "active" ? (
          <>
            <Button
              variant="ghost"
              disabled={isPending}
              onClick={() => handleAction("skip")}
            >
              {labels.skipNext}
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => handleAction("pause")}
            >
              {labels.pauseSubscription}
            </Button>
            {canChangeFrequency ? (
              <Button
                variant="outline"
                disabled={isPending}
                aria-expanded={openPanel === "frequency"}
                onClick={() => togglePanel("frequency")}
              >
                {labels.changeFrequency}
              </Button>
            ) : null}
            <Button
              variant="destructive"
              disabled={isPending}
              aria-expanded={openPanel === "cancel"}
              onClick={() => togglePanel("cancel")}
            >
              {labels.cancelSubscription}
            </Button>
          </>
        ) : (
          <Button disabled={isPending} onClick={() => handleAction("activate")}>
            {labels.resumeSubscription}
          </Button>
        )}
      </SubscriptionActionRow>

      {/* お届け頻度を変更 (Figma 6719:14705 / SP 6723:14845) */}
      {openPanel === "frequency" && kind === "active" ? (
        <SubscriptionPanel title={labels.changeFrequency}>
          <SubscriptionPanelHint>{labels.selectFrequency}</SubscriptionPanelHint>
          <SubscriptionActionRow>
            {frequencyOptions.map((option) => {
              const isCurrent = isSameFrequency(
                option,
                currentInterval,
                currentIntervalCount
              );
              return (
                <Button
                  key={frequencyOptionKey(option)}
                  /* 確定版の chips は 5 個すべて塗りなし (ghost)。いま契約している
                     頻度をどう示すかは確定版に指定が無いので、塗り (primary) +
                     `aria-pressed` で示す (押せないだけだと画面上でどれが現在値か
                     分からず、頻度変更の主目的が果たせない)。DS の控えめな塗り
                     `secondary` は二重定義で実行時に金色に解決するため使わない
                     (是正は DS トークン整合タスク 3b670c9d-064c-8166 側)。 */
                  variant={isCurrent ? "default" : "ghost"}
                  aria-pressed={isCurrent}
                  disabled={isPending || isCurrent}
                  onClick={() => handleFrequencyChange(option)}
                >
                  {labels.frequencyOptionLabels[frequencyOptionKey(option)]}
                </Button>
              );
            })}
          </SubscriptionActionRow>
          <SubscriptionActionRow>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setOpenPanel(null)}
            >
              {labels.cancel}
            </Button>
          </SubscriptionActionRow>
          {successMessage ? (
            <SubscriptionMessage>{successMessage}</SubscriptionMessage>
          ) : null}
          {error ? (
            <SubscriptionMessage tone="error">{error}</SubscriptionMessage>
          ) : null}
        </SubscriptionPanel>
      ) : null}

      {/* 解約 (Figma 6719:14723 / SP 6723:14863) — 破壊的操作なので必ず確認を挟む */}
      {openPanel === "cancel" && kind === "active" ? (
        <SubscriptionPanel title={labels.cancelPanelTitle}>
          <SubscriptionPanelBody>{labels.cancelConfirmBody}</SubscriptionPanelBody>
          <SubscriptionActionRow>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => handleAction("cancel")}
            >
              {labels.confirmCancel}
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setOpenPanel(null)}
            >
              {labels.cancel}
            </Button>
          </SubscriptionActionRow>
          {successMessage ? (
            <SubscriptionMessage>{successMessage}</SubscriptionMessage>
          ) : null}
          {error ? (
            <SubscriptionMessage tone="error">{error}</SubscriptionMessage>
          ) : null}
        </SubscriptionPanel>
      ) : null}

      {/* パネルを開いていないときの結果表示 (スキップ / 停止 / 再開) */}
      {openPanel === null && successMessage ? (
        <SubscriptionMessage>{successMessage}</SubscriptionMessage>
      ) : null}
      {openPanel === null && error ? (
        <SubscriptionMessage tone="error">{error}</SubscriptionMessage>
      ) : null}
    </>
  );
}
