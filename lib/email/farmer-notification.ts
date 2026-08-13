import { Resend } from "resend";
import { siteUrl } from "@/lib/site-url";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "info@elxea.com";
const SITE_URL = siteUrl();

// ─── Types ────────────────────────────────────────────────────────────

export type FarmerNotificationItem = {
  /** "article" | "product" */
  type: "article" | "product";
  /** Article slug or Shopify product handle */
  slug: string;
  title: string;
  /** Thumbnail image URL */
  imageUrl: string | null;
  /** Full URL to the item on the site */
  url: string;
  /** Brief excerpt or description */
  excerpt: string | null;
};

export type FarmerNotificationData = {
  /** Recipient email address */
  customerEmail: string;
  /** Recipient display name */
  customerName: string;
  /** Farmer display name */
  farmerName: string;
  /** Farmer's page slug */
  farmerSlug: string;
  /** New items published since the last notification */
  newItems: FarmerNotificationItem[];
};

// ─── Formatters ───────────────────────────────────────────────────────

function farmerPageUrl(slug: string): string {
  return `${SITE_URL}/ja/people/${slug}`;
}

function itemTypeLabel(type: FarmerNotificationItem["type"]): string {
  return type === "article" ? "新着記事" : "新着商品";
}

// ─── Plain text ───────────────────────────────────────────────────────

function buildTextEmail(data: FarmerNotificationData): string {
  const itemLines = data.newItems
    .map(
      (item) =>
        `[${itemTypeLabel(item.type)}] ${item.title}\n${item.url}${item.excerpt ? `\n${item.excerpt}` : ""}`
    )
    .join("\n\n");

  return `${data.customerName} 様

roji by elxea をいつもご利用いただきありがとうございます。

フォロー中の農家「${data.farmerName}」さんから新着情報が届きました。

${itemLines}

─────────────────────────────────────
農家プロフィールはこちら
${farmerPageUrl(data.farmerSlug)}

フォロー解除はマイページから行えます。
${SITE_URL}/ja/account

─────────────────────────────────────
roji by elxea
${SITE_URL}
`;
}

// ─── HTML ─────────────────────────────────────────────────────────────

function buildItemCard(item: FarmerNotificationItem): string {
  const imageHtml = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="${item.title}" width="100%" style="display:block; margin-bottom:12px; max-height:200px; object-fit:cover;" />`
    : "";

  const excerptHtml = item.excerpt
    ? `<p style="font-size:13px; color:#555; line-height:1.7; margin:0 0 12px;">${item.excerpt}</p>`
    : "";

  return `
    <div style="border:1px solid #e8e8e8; padding:20px; margin-bottom:16px; background-color:#fff;">
      ${imageHtml}
      <p style="font-size:11px; color:#999; letter-spacing:1px; margin:0 0 6px; text-transform:uppercase;">
        ${itemTypeLabel(item.type)}
      </p>
      <p style="font-size:15px; color:#1a1a1a; font-weight:500; margin:0 0 8px;">
        <a href="${item.url}" style="color:#1a1a1a; text-decoration:none;">${item.title}</a>
      </p>
      ${excerptHtml}
      <a href="${item.url}"
         style="font-size:12px; color:#1a1a1a; text-decoration:underline; letter-spacing:0.5px;">
        詳しく見る →
      </a>
    </div>`;
}

function buildHtmlEmail(data: FarmerNotificationData): string {
  const itemCards = data.newItems.map(buildItemCard).join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#FFFEF2; font-family:-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif;">
  <div style="max-width:600px; margin:0 auto; padding:40px 20px;">

    <!-- Header -->
    <div style="text-align:center; margin-bottom:32px;">
      <p style="font-size:14px; letter-spacing:2px; color:#1a1a1a; margin:0;">roji by elxea</p>
    </div>

    <!-- Body -->
    <div style="background-color:#ffffff; padding:32px; border:1px solid #e8e8e8;">
      <p style="font-size:14px; color:#1a1a1a; margin:0 0 8px;">${data.customerName} 様</p>
      <p style="font-size:14px; color:#555; line-height:1.8; margin:0 0 24px;">
        フォロー中の農家 <strong>${data.farmerName}</strong> さんから新着情報が届きました。
      </p>

      ${itemCards}

      <!-- Farmer page CTA -->
      <div style="text-align:center; margin:28px 0 8px;">
        <a href="${farmerPageUrl(data.farmerSlug)}"
           style="display:inline-block; padding:12px 32px; background-color:#1a1a1a; color:#ffffff; text-decoration:none; font-size:13px; letter-spacing:1px;">
          ${data.farmerName} さんのページを見る
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center; margin-top:28px;">
      <p style="font-size:12px; color:#aaa; margin:0 0 6px;">
        このメールは ${data.farmerName} さんをフォローしているため送信されました。
      </p>
      <p style="font-size:12px; color:#aaa; margin:0;">
        フォロー解除は
        <a href="${SITE_URL}/ja/account" style="color:#aaa; text-decoration:underline;">マイページ</a>
        から行えます。
      </p>
      <p style="font-size:12px; color:#aaa; margin:12px 0 0;">
        <a href="${SITE_URL}" style="color:#aaa; text-decoration:none;">roji by elxea</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Send function ────────────────────────────────────────────────────

export async function sendFarmerNotification(
  data: FarmerNotificationData
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const { error } = await getResend().emails.send({
    from: `roji by elxea <${FROM_EMAIL}>`,
    to: [data.customerEmail],
    subject: `【roji】${data.farmerName} さんから新着情報が届きました`,
    text: buildTextEmail(data),
    html: buildHtmlEmail(data),
  });

  if (error) {
    console.error("[FarmerNotification] Resend error:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
