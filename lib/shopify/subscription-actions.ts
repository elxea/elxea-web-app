"use server";

import { getSession } from "./auth";
import {
  pauseSubscription,
  activateSubscription,
  cancelSubscription,
  skipNextBillingCycle,
  verifySubscriptionContractOwnership,
  isSubscriptionContractGid,
} from "./customer";
import { updateSubscriptionContract, changeSubscriptionLineItem } from "./subscription-admin";
import type { SellingPlanInterval } from "./admin-types";

type ActionResult = { success: boolean; error?: string };

/**
 * Generic failure message for anything the caller is not allowed to do.
 *
 * Deliberately identical for "contract does not exist", "contract belongs to
 * someone else" and "ownership could not be verified" so the response cannot be
 * used to probe which contract IDs exist on the store.
 */
const NOT_AUTHORIZED = "Subscription not found or not accessible";

async function getAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session.accessToken;
}

/**
 * Authenticate the caller AND prove that they own `contractId`.
 *
 * Why this exists: these are Server Actions, so every exported function here is
 * a public HTTP endpoint. `contractId` arrives from the client and is not
 * trustworthy. Checking only "is someone logged in" lets any logged-in customer
 * operate on another customer's contract — the Admin API token used downstream
 * is store-wide and does not scope requests to the caller.
 *
 * Fail-closed: this throws unless ownership is positively proven. Verification
 * failures (network error, GraphQL error) are treated as "not the owner".
 *
 * Actions that call the Customer Account API with the customer's own token
 * (pause / activate / cancel / skip) are already scoped by Shopify to that
 * customer, so they do not need this extra round-trip. Actions that reach the
 * Admin API do.
 */
async function authorizeContractAccess(contractId: string): Promise<string> {
  const token = await getAccessToken();

  if (!isSubscriptionContractGid(contractId)) {
    throw new Error(NOT_AUTHORIZED);
  }

  const owned = await verifySubscriptionContractOwnership(token, contractId);
  if (!owned) {
    throw new Error(NOT_AUTHORIZED);
  }

  return token;
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
  if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 12) {
    return { success: false, error: "Invalid interval count" };
  }

  // Authenticate the caller and prove they own this contract before touching
  // the store-wide Admin API.
  try {
    await authorizeContractAccess(contractId);
  } catch (error) {
    const message = error instanceof Error ? error.message : NOT_AUTHORIZED;
    return { success: false, error: message };
  }

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
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { success: false, error: "Invalid quantity" };
  }

  // Authenticate the caller and prove they own this contract before touching
  // the store-wide Admin API.
  try {
    await authorizeContractAccess(contractId);
  } catch (error) {
    const message = error instanceof Error ? error.message : NOT_AUTHORIZED;
    return { success: false, error: message };
  }

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
