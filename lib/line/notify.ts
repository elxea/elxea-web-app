/**
 * LINE Messaging API - Push notification for internal monitoring.
 * Used to alert Setaka when subscription events require attention.
 *
 * Setup: Create a LINE Messaging API channel at https://developers.line.biz/
 * Environment vars required:
 *   LINE_CHANNEL_ACCESS_TOKEN - Channel access token from LINE Developers Console
 *   LINE_ADMIN_USER_ID        - LINE user ID of the admin to push to
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const LINE_ADMIN_USER_ID = process.env.LINE_ADMIN_USER_ID || "";
const LINE_PUSH_API = "https://api.line.me/v2/bot/message/push";

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
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_ADMIN_USER_ID) {
    console.warn("[LINE Notify] Credentials not configured, skipping notification.");
    return;
  }

  const emoji = level === "error" ? "🔴" : level === "warning" ? "🟡" : "🔵";
  const text = `${emoji} ${subject}\n\n${body}`;

  try {
    const response = await fetch(LINE_PUSH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: LINE_ADMIN_USER_ID,
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
