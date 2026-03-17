"use server";

import { getSession } from "./auth";
import {
  pauseSubscription,
  activateSubscription,
  cancelSubscription,
  skipNextBillingCycle,
} from "./customer";

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
