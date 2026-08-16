"use client";

import { useSyncExternalStore } from "react";

import {
  CONSENT_STORAGE_KEY,
  type ConsentChoice,
  persistConsent,
  readStoredConsent,
} from "@/lib/consent";

/**
 * One shared consent store for the whole page.
 *
 * Both the banner and the Google Tag Manager gate read from here, so a click on
 * "同意する" flips both in the same tick: the banner unmounts and the GTM
 * container mounts without a reload. A `storage` event keeps other tabs in
 * sync.
 *
 * `"unknown"` is the server / pre-hydration value. It is deliberately distinct
 * from `null` ("visitor has made no choice"): during SSR we must render neither
 * the banner (it would flash for visitors who already chose) nor GTM (it would
 * load before consent). Both only appear once the client has read the store.
 */
export type ConsentState = ConsentChoice | null | "unknown";

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedChoice: ConsentChoice | null | undefined;
let bannerForcedOpen = false;
let windowListenersAttached = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function invalidateAndNotify(): void {
  cachedChoice = undefined;
  notify();
}

function handleStorageEvent(event: StorageEvent): void {
  // `key === null` is a `localStorage.clear()` from another tab.
  if (event.key === null || event.key === CONSENT_STORAGE_KEY) invalidateAndNotify();
}

function attachWindowListeners(): void {
  if (windowListenersAttached || typeof window === "undefined") return;
  windowListenersAttached = true;
  window.addEventListener("storage", handleStorageEvent);
}

function subscribe(listener: Listener): () => void {
  attachWindowListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getChoiceSnapshot(): ConsentState {
  if (cachedChoice === undefined) cachedChoice = readStoredConsent();
  return cachedChoice;
}

function getServerChoiceSnapshot(): ConsentState {
  return "unknown";
}

function getForcedOpenSnapshot(): boolean {
  return bannerForcedOpen;
}

function getServerForcedOpenSnapshot(): boolean {
  return false;
}

/** `"unknown"` until hydrated, then the stored choice (`null` = not chosen). */
export function useConsentChoice(): ConsentState {
  return useSyncExternalStore(subscribe, getChoiceSnapshot, getServerChoiceSnapshot);
}

/** True while the visitor has explicitly asked to revisit their choice. */
export function useConsentBannerForcedOpen(): boolean {
  return useSyncExternalStore(subscribe, getForcedOpenSnapshot, getServerForcedOpenSnapshot);
}

/** Records a choice and closes the banner. */
export function setConsentChoice(choice: ConsentChoice): void {
  persistConsent(choice);
  cachedChoice = choice;
  bannerForcedOpen = false;
  notify();
}

/**
 * Re-opens the banner so a visitor can change their mind (拒否 → 同意 and back).
 * The stored choice is left untouched until they pick again, so nothing is
 * "un-consented" just by opening the panel.
 */
export function openConsentBanner(): void {
  bannerForcedOpen = true;
  notify();
}

/** Test seam. Not used by the app. */
export function resetConsentStoreForTests(): void {
  cachedChoice = undefined;
  bannerForcedOpen = false;
}
