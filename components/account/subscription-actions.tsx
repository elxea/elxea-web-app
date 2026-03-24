"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  pauseSubscriptionAction,
  activateSubscriptionAction,
  cancelSubscriptionAction,
  skipNextDeliveryAction,
  changeDeliveryFrequencyAction,
} from "@/lib/shopify/subscription-actions";

type FrequencyOption = {
  label: string;
  interval: "WEEK" | "MONTH";
  intervalCount: number;
};

export type SubscriptionActionLabels = {
  skipNext: string;
  changeFrequency: string;
  pauseSubscription: string;
  cancelSubscription: string;
  confirmCancel: string;
  resumeSubscription: string;
  selectFrequency: string;
  cancel: string;
  actionError: string;
  frequencyChanged: string;
  frequencyChangeError: string;
  frequencyOptions: {
    everyWeek: string;
    every2Weeks: string;
    everyMonth: string;
    every2Months: string;
    every3Months: string;
  };
};

export function SubscriptionActions({
  contractId,
  status,
  currentInterval,
  currentIntervalCount,
  labels,
}: {
  contractId: string;
  status: string;
  currentInterval?: string;
  currentIntervalCount?: number;
  labels: SubscriptionActionLabels;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [showFrequencyPicker, setShowFrequencyPicker] = useState(false);

  const frequencyOptions: FrequencyOption[] = [
    { label: labels.frequencyOptions.everyWeek, interval: "WEEK", intervalCount: 1 },
    { label: labels.frequencyOptions.every2Weeks, interval: "WEEK", intervalCount: 2 },
    { label: labels.frequencyOptions.everyMonth, interval: "MONTH", intervalCount: 1 },
    { label: labels.frequencyOptions.every2Months, interval: "MONTH", intervalCount: 2 },
    { label: labels.frequencyOptions.every3Months, interval: "MONTH", intervalCount: 3 },
  ];

  function isCurrentFrequency(option: FrequencyOption): boolean {
    return (
      option.interval === currentInterval &&
      option.intervalCount === currentIntervalCount
    );
  }

  async function handleAction(action: string) {
    if (action === "cancel" && confirmAction !== "cancel") {
      setConfirmAction("cancel");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      let result;
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
          result = await skipNextDeliveryAction(contractId);
          break;
      }

      if (result && !result.success) {
        setError(result.error ?? labels.actionError);
      } else {
        setConfirmAction(null);
        router.refresh();
      }
    });
  }

  async function handleFrequencyChange(option: FrequencyOption) {
    if (isCurrentFrequency(option)) return;

    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await changeDeliveryFrequencyAction(
        contractId,
        option.interval,
        option.intervalCount
      );

      if (result.success) {
        setShowFrequencyPicker(false);
        setSuccessMessage(labels.frequencyChanged);
        router.refresh();
      } else {
        setError(result.error ?? labels.frequencyChangeError);
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {status === "ACTIVE" && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => handleAction("skip")}
            >
              {labels.skipNext}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setShowFrequencyPicker(!showFrequencyPicker);
                setConfirmAction(null);
              }}
            >
              {labels.changeFrequency}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => handleAction("pause")}
            >
              {labels.pauseSubscription}
            </Button>
            {confirmAction === "cancel" ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => handleAction("cancel")}
              >
                {labels.confirmCancel}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                className="text-muted-foreground"
                onClick={() => handleAction("cancel")}
              >
                {labels.cancelSubscription}
              </Button>
            )}
          </>
        )}
        {status === "PAUSED" && (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleAction("activate")}
          >
            {labels.resumeSubscription}
          </Button>
        )}
      </div>

      {/* Frequency picker */}
      {showFrequencyPicker && status === "ACTIVE" && (
        <div className="mt-4 p-4 border border-border bg-muted/30">
          <p className="text-xs text-muted-foreground mb-3">
            {labels.selectFrequency}
          </p>
          <div className="flex flex-wrap gap-2">
            {frequencyOptions.map((option) => {
              const isCurrent = isCurrentFrequency(option);
              return (
                <Button
                  key={`${option.interval}-${option.intervalCount}`}
                  variant={isCurrent ? "default" : "outline"}
                  size="sm"
                  disabled={isPending || isCurrent}
                  onClick={() => handleFrequencyChange(option)}
                  className={isCurrent ? "pointer-events-none" : ""}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFrequencyPicker(false)}
              disabled={isPending}
              className="text-muted-foreground"
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive mt-2">{error}</p>
      )}
      {successMessage && (
        <p className="text-xs text-green-700 mt-2">{successMessage}</p>
      )}
    </div>
  );
}
