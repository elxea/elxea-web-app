"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  pauseSubscriptionAction,
  activateSubscriptionAction,
  cancelSubscriptionAction,
  skipNextDeliveryAction,
} from "@/lib/shopify/subscription-actions";

export function SubscriptionActions({
  contractId,
  status,
}: {
  contractId: string;
  status: string;
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  async function handleAction(action: string) {
    if (action === "cancel" && confirmAction !== "cancel") {
      setConfirmAction("cancel");
      return;
    }

    setError(null);
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
        setError(result.error ?? t("actionError"));
      } else {
        setConfirmAction(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {status === "ACTIVE" && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleAction("skip")}
          >
            {t("skipNext")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleAction("pause")}
          >
            {t("pauseSubscription")}
          </Button>
          {confirmAction === "cancel" ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => handleAction("cancel")}
            >
              {t("confirmCancel")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              className="text-muted-foreground"
              onClick={() => handleAction("cancel")}
            >
              {t("cancelSubscription")}
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
          {t("resumeSubscription")}
        </Button>
      )}
      {error && (
        <p className="text-xs text-destructive w-full mt-1">{error}</p>
      )}
    </div>
  );
}
