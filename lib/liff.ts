/**
 * LIFF SDK utilities for LINE Login with mobile app direct launch.
 *
 * On mobile browsers, LIFF SDK's liff.login() triggers Universal Links
 * (iOS) / App Links (Android) to open the LINE app directly, providing
 * a one-tap authentication experience instead of the access.line.me
 * browser login screen.
 *
 * On desktop, we fall back to Auth.js LINE Provider which shows the
 * QR code login flow.
 */
import liff from "@line/liff";

let initialized = false;

/**
 * Initialize the LIFF SDK. Safe to call multiple times (idempotent).
 * Must be called before any other LIFF API.
 */
export async function initLiff(liffId: string): Promise<void> {
  if (initialized) return;

  await liff.init({ liffId });
  initialized = true;
}

/**
 * Detect if the current device is a mobile device.
 * Uses User-Agent heuristic -- sufficient for login UX branching.
 */
export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Check if the LINE app is available (LIFF is running inside LINE).
 */
export function isInLineApp(): boolean {
  if (!initialized) return false;
  return liff.isInClient();
}

/**
 * Start LIFF login flow. On mobile external browsers, this redirects
 * to the LINE app via Universal Links / App Links.
 *
 * @param redirectUri - URL to redirect back to after LINE authentication
 */
export function startLiffLogin(redirectUri: string): void {
  liff.login({ redirectUri });
}

/**
 * Check if the user is currently logged in via LIFF.
 */
export function isLiffLoggedIn(): boolean {
  if (!initialized) return false;
  return liff.isLoggedIn();
}

/**
 * Get the raw ID token from LIFF session.
 * This should be sent to the server for verification, NOT the decoded token.
 */
export function getLiffIdToken(): string | null {
  if (!initialized) return null;
  return liff.getIDToken();
}

/**
 * Get the LIFF access token.
 */
export function getLiffAccessToken(): string | null {
  if (!initialized) return null;
  return liff.getAccessToken();
}

/**
 * Get the user's LINE profile via LIFF.
 */
export async function getLiffProfile(): Promise<{
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
} | null> {
  if (!initialized || !liff.isLoggedIn()) return null;
  try {
    return await liff.getProfile();
  } catch {
    return null;
  }
}

/**
 * Logout from LIFF session.
 */
export function liffLogout(): void {
  if (!initialized) return;
  if (liff.isLoggedIn()) {
    liff.logout();
  }
}

export { liff };
