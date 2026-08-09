import { Resend } from "resend";

import { formatPrice } from "@/lib/format-price";

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
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://elxea.com";

type SubscriptionReminderData = {
  customerEmail: string;
  customerName: string;
  nextBillingDate: string;
  items: {
    title: string;
    quantity: number;
    price: string;
    currencyCode: string;
  }[];
  deliveryInterval: string;
};

/* 金額整形は `lib/format-price.ts` の共通実装を使う (旧: このファイルに複製が
   あり、`Intl` 既定の全角 `￥` が出ていた。dunning.ts と同じ是正)。 */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildTextEmail(data: SubscriptionReminderData): string {
  const itemsList = data.items
    .map(
      (item) =>
        `  - ${item.title} x ${item.quantity} (${formatPrice(item.price, item.currencyCode)})`
    )
    .join("\n");

  return `${data.customerName} 様

いつも roji by elxea をご利用いただきありがとうございます。

定期便の次回お届けについてお知らせいたします。

■ 次回お届け予定日
${formatDate(data.nextBillingDate)}

■ お届け予定商品
${itemsList}

■ お届けサイクル
${data.deliveryInterval}

定期便の内容変更・一時停止・解約は、マイページから行えます。
${SITE_URL}/ja/account

※ 次回お届け日の変更をご希望の場合は、お届け日の3日前までにマイページよりお手続きください。

---
roji by elxea
${SITE_URL}
`;
}

function buildHtmlEmail(data: SubscriptionReminderData): string {
  const itemRows = data.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
            ${item.title}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; text-align: center;">
            ${item.quantity}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; text-align: right;">
            ${formatPrice(item.price, item.currencyCode)}
          </td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FFFEF2; font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <p style="font-size: 14px; letter-spacing: 2px; color: #1a1a1a; margin: 0;">roji by elxea</p>
    </div>

    <!-- Content -->
    <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e8e8e8;">
      <p style="font-size: 14px; color: #1a1a1a; margin: 0 0 24px;">
        ${data.customerName} 様
      </p>

      <p style="font-size: 14px; color: #555; line-height: 1.8; margin: 0 0 24px;">
        いつも roji by elxea をご利用いただきありがとうございます。<br>
        定期便の次回お届けについてお知らせいたします。
      </p>

      <!-- Next billing date -->
      <div style="background-color: #FFFEF2; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 12px; color: #888; margin: 0 0 4px;">次回お届け予定日</p>
        <p style="font-size: 16px; color: #1a1a1a; margin: 0; font-weight: 500;">
          ${formatDate(data.nextBillingDate)}
        </p>
      </div>

      <!-- Items table -->
      <p style="font-size: 12px; color: #888; margin: 0 0 8px;">お届け予定商品</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #1a1a1a; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px 0; border-bottom: 2px solid #e8e8e8; font-weight: normal; color: #888; font-size: 12px;">商品名</th>
            <th style="text-align: center; padding: 8px 0; border-bottom: 2px solid #e8e8e8; font-weight: normal; color: #888; font-size: 12px;">数量</th>
            <th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #e8e8e8; font-weight: normal; color: #888; font-size: 12px;">金額</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- Delivery interval -->
      <p style="font-size: 12px; color: #888; margin: 0 0 4px;">お届けサイクル</p>
      <p style="font-size: 14px; color: #1a1a1a; margin: 0 0 32px;">${data.deliveryInterval}</p>

      <!-- CTA -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${SITE_URL}/ja/account"
           style="display: inline-block; padding: 12px 32px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; letter-spacing: 1px;">
          マイページで確認
        </a>
      </div>

      <p style="font-size: 12px; color: #888; line-height: 1.8; margin: 0;">
        ※ 次回お届け日の変更をご希望の場合は、お届け日の3日前までにマイページよりお手続きください。
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="font-size: 12px; color: #888; margin: 0;">
        <a href="${SITE_URL}" style="color: #888; text-decoration: none;">roji by elxea</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendSubscriptionReminder(
  data: SubscriptionReminderData
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const text = buildTextEmail(data);
  const html = buildHtmlEmail(data);

  const { error } = await getResend().emails.send({
    from: `roji by elxea <${FROM_EMAIL}>`,
    to: [data.customerEmail],
    subject: `【roji】定期便のお届け予定のお知らせ - ${formatDate(data.nextBillingDate)}`,
    text,
    html,
  });

  if (error) {
    console.error("[Subscription Reminder] Resend error:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
