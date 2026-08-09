import { Resend } from "resend";

import { formatPrice } from "@/lib/format-price";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@elxea.com";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://elxea.com";

type DunningEmailData = {
  customerEmail: string;
  customerName: string;
  attemptNumber: number; // 1, 2, or 3
  isFinalAttempt: boolean;
  items: {
    title: string;
    quantity: number;
    price: string;
    currencyCode: string;
  }[];
};

/* 金額整形は `lib/format-price.ts` の共通実装を使う (旧: このファイルに複製が
   あり、`Intl` 既定の全角 `￥` が出ていた。Web 側は DS レーンで半角 `¥` に
   是正済みで、メール文面だけ残っていた差分を閉じる)。 */

function buildTextEmail(data: DunningEmailData): string {
  const itemsList = data.items
    .map(
      (item) =>
        `  - ${item.title} x ${item.quantity} (${formatPrice(item.price, item.currencyCode)})`
    )
    .join("\n");

  if (data.isFinalAttempt) {
    return `${data.customerName} 様

いつも roji by elxea をご利用いただきありがとうございます。

定期便のお支払いについて、複数回の決済を試みましたが完了できませんでした。
誠に恐れ入りますが、お支払い方法をご確認いただけますようお願いいたします。

定期便は一時停止となりました。お支払い方法を更新後、マイページから再開していただけます。

■ 対象商品
${itemsList}

■ お支払い方法の更新
${SITE_URL}/ja/account

ご不明な点がございましたら、お気軽にお問い合わせください。

---
roji by elxea
${SITE_URL}
`;
  }

  return `${data.customerName} 様

いつも roji by elxea をご利用いただきありがとうございます。

定期便のお支払いが完了できませんでした（${data.attemptNumber}回目）。
お支払い方法をご確認いただき、必要に応じて更新をお願いいたします。

■ 対象商品
${itemsList}

■ お支払い方法の確認・更新
${SITE_URL}/ja/account

※ 自動的に再度決済を試みますが、解決しない場合は定期便が一時停止となる場合がございます。

---
roji by elxea
${SITE_URL}
`;
}

function buildHtmlEmail(data: DunningEmailData): string {
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

  const statusMessage = data.isFinalAttempt
    ? `<p style="font-size: 14px; color: #555; line-height: 1.8; margin: 0 0 24px;">
        定期便のお支払いについて、複数回の決済を試みましたが完了できませんでした。<br>
        誠に恐れ入りますが、お支払い方法をご確認いただけますようお願いいたします。
      </p>
      <div style="background-color: #FFF3F3; padding: 16px; margin-bottom: 24px; border-left: 3px solid #E53E3E;">
        <p style="font-size: 14px; color: #E53E3E; margin: 0; font-weight: 500;">
          定期便は一時停止となりました
        </p>
        <p style="font-size: 13px; color: #555; margin: 8px 0 0;">
          お支払い方法を更新後、マイページから再開していただけます。
        </p>
      </div>`
    : `<p style="font-size: 14px; color: #555; line-height: 1.8; margin: 0 0 24px;">
        定期便のお支払いが完了できませんでした（${data.attemptNumber}回目）。<br>
        お支払い方法をご確認いただき、必要に応じて更新をお願いいたします。
      </p>
      <div style="background-color: #FFFBEB; padding: 16px; margin-bottom: 24px; border-left: 3px solid #D69E2E;">
        <p style="font-size: 13px; color: #555; margin: 0;">
          自動的に再度決済を試みますが、解決しない場合は定期便が一時停止となる場合がございます。
        </p>
      </div>`;

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

      ${statusMessage}

      <!-- Items table -->
      <p style="font-size: 12px; color: #888; margin: 0 0 8px;">対象商品</p>
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

      <!-- CTA -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${SITE_URL}/ja/account"
           style="display: inline-block; padding: 12px 32px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; letter-spacing: 1px;">
          お支払い方法を確認
        </a>
      </div>

      <p style="font-size: 12px; color: #888; line-height: 1.8; margin: 0;">
        ※ ご不明な点がございましたら、お気軽にお問い合わせください。
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

export async function sendDunningEmail(
  data: DunningEmailData
): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(RESEND_API_KEY);

  const text = buildTextEmail(data);
  const html = buildHtmlEmail(data);

  const subject = data.isFinalAttempt
    ? "【roji】定期便のお支払いについて（一時停止のお知らせ）"
    : `【roji】定期便のお支払いについて（${data.attemptNumber}回目）`;

  try {
    const { error } = await resend.emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: data.customerEmail,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("[Dunning Email] Resend error:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Dunning Email] Resend error:", message);
    return { success: false, error: message };
  }
}
