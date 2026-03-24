"use server";

import { getSession } from "./auth";
import {
  pauseSubscription,
  activateSubscription,
  cancelSubscription,
  skipNextBillingCycle,
} from "./customer";
import { updateSubscriptionContract, changeSubscriptionLineItem } from "./subscription-admin";
import type { SellingPlanInterval } from "./admin-types";

type ActionResult = { success: boolean; error?: string };

async function getAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session.accessToken;
}

export async function pauseSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  return pauseSubscription(token, contractId);
}

export async function activateSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  return activateSubscription(token, contractId);
}

export async function cancelSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  return cancelSubscription(token, contractId);
}

export async function skipNextDeliveryAction(
  contractId: string,
  billingCycleIndex: number = 0
) {
  const token = await getAccessToken();
  return skipNextBillingCycle(token, contractId, billingCycleIndex);
}

/**
 * Change the delivery/billing frequency of a subscription contract.
 * Uses the Admin API draft pattern (requires Admin API token).
 */
export async function changeDeliveryFrequencyAction(
  contractId: string,
  interval: SellingPlanInterval,
  intervalCount: number
): Promise<ActionResult> {
  // Validate input
  const validIntervals: SellingPlanInterval[] = ["DAY", "WEEK", "MONTH", "YEAR"];
  if (!validIntervals.includes(interval)) {
    return { success: false, error: "Invalid interval" };
  }
  if (intervalCount < 1 || intervalCount > 12) {
    return { success: false, error: "Invalid interval count" };
  }

  // Ensure user is authenticated
  await getAccessToken();

  try {
    await updateSubscriptionContract(contractId, {
      deliveryPolicy: { interval, intervalCount },
      billingPolicy: { interval, intervalCount },
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[changeDeliveryFrequency] Error:", message);
    return { success: false, error: message };
  }
}

/**
 * Change a product in a subscription contract.
 * Removes the old line item and adds a new one via the Admin API draft pattern.
 */
export async function changeSubscriptionProductAction(
  contractId: string,
  oldLineId: string,
  newVariantId: string,
  newPrice: string,
  quantity: number = 1
): Promise<ActionResult> {
  if (!contractId || !oldLineId || !newVariantId || !newPrice) {
    return { success: false, error: "Missing required parameters" };
  }

  // Ensure user is authenticated
  await getAccessToken();

  try {
    await changeSubscriptionLineItem(contractId, oldLineId, {
      productVariantId: newVariantId,
      currentPrice: newPrice,
      quantity,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[changeSubscriptionProduct] Error:", message);
    return { success: false, error: message };
  }
}
