/**
 * LINE Messaging API - Push notification for internal monitoring.
 * Used to alert Setaka when subscription events require attention.
 *
 * Setup: Create a LINE Messaging API channel at https://developers.line.biz/
 * Environment vars required:
 *   LINE_CHANNEL_ACCESS_TOKEN - Channel access token from LINE Developers Console
 *   LINE_ADMIN_USER_ID        - LINE user ID of the admin to push to
 *   LINE_API_BASE_URL         - Optional. Overrides the LINE API host (tests only).
 */

import { env } from "@/lib/config";
import { lineApiBaseUrl } from "@/lib/line/endpoints";

/** Messaging API の push エンドポイント。ホストは `LINE_API_BASE_URL` で差し替え可能
 *  （未設定なら本物の LINE）。テストが実際に LINE へ push してしまうのを防ぐため。 */
function linePushApi(): string {
  return `${lineApiBaseUrl()}/v2/bot/message/push`;
}

export type LineNotifyPayload = {
  subject: string;
  body: string;
  level?: "info" | "warning" | "error";
};

/**
 * Send a push message to the admin LINE account.
 * Silently fails if LINE credentials are not configured.
 */
export async function sendLineNotify({
  subject,
  body,
  level = "info",
}: LineNotifyPayload): Promise<void> {
  // Read the credentials per call, not once at module load. Two reasons:
  //   1. On Vercel these are injected per deployment/invocation; a module-level
  //      snapshot taken during cold start of a build-time import can be empty
  //      while the runtime value is present.
  //   2. A module-level snapshot makes the "not configured" branch untestable
  //      without resetting the module registry.
  const accessToken = env("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
  const adminUserId = env("LINE_ADMIN_USER_ID") ?? "";

  if (!accessToken || !adminUserId) {
    console.warn("[LINE Notify] Credentials not configured, skipping notification.");
    return;
  }

  const emoji = level === "error" ? "🔴" : level === "warning" ? "🟡" : "🔵";
  const text = `${emoji} ${subject}\n\n${body}`;

  try {
    const response = await fetch(linePushApi(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: adminUserId,
        messages: [{ type: "text", text }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE Notify] Push failed:", response.status, errorText);
    }
  } catch (error) {
    console.error("[LINE Notify] Unexpected error:", error);
  }
}
