import { Resend } from "resend";
import { env } from "@/lib/config";
import { siteUrl } from "@/lib/site-url";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = env("RESEND_API_KEY");
    if (!key) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM_EMAIL = env("RESEND_FROM_EMAIL") ?? "info@elxea.com";
const SITE_URL = siteUrl();

type WelcomeEmailData = {
  customerEmail: string;
  customerName: string;
  locale?: "ja" | "en";
};

function buildTextEmail(data: WelcomeEmailData): string {
  if (data.locale === "en") {
    return `${data.customerName},

Welcome to roji by elxea.

We are delighted to have you as a member.

roji is a specialty tea brand that delivers carefully selected Japanese teas directly from farmers to your doorstep. Through transparent, direct-trade relationships, we share teas that tell the story of their origin.

Here is what you can do as a member:

  - Browse our curated selection of specialty teas
  - Subscribe for seasonal teas delivered to your door
  - Explore our journal for stories about tea and the people who grow it
  - Discover the farmers behind your cup

Start exploring:
${SITE_URL}/en

If you have any questions, please don't hesitate to reach out.
info@elxea.com

---
roji by elxea
${SITE_URL}
`;
  }

  return `${data.customerName} 様

roji by elxea へようこそ。

会員登録いただき、ありがとうございます。

roji は、日本各地の茶農家が丹精込めて育てたスペシャルティティーを、直接お届けするお茶のブランドです。生産者の顔が見える透明性のある取引を通じて、お茶の新しい価値と体験をお届けします。

会員として、以下のことをお楽しみいただけます：

  - 厳選されたスペシャルティティーのご購入
  - 季節のお茶が届く定期便へのご加入
  - お茶と農家の物語を綴るジャーナルの閲覧
  - お茶を育てた農家の方々のご紹介

さっそく探索してみてください：
${SITE_URL}/ja

ご不明な点がございましたら、お気軽にお問い合わせください。
info@elxea.com

---
roji by elxea
${SITE_URL}
`;
}

function buildHtmlEmail(data: WelcomeEmailData): string {
  const isEn = data.locale === "en";

  const content = isEn
    ? {
        greeting: `${data.customerName},`,
        headline: "Welcome to roji by elxea",
        intro:
          "We are delighted to have you as a member. roji is a specialty tea brand that delivers carefully selected Japanese teas directly from farmers to your doorstep.",
        listTitle: "As a member, you can:",
        items: [
          "Browse our curated selection of specialty teas",
          "Subscribe for seasonal teas delivered to your door",
          "Explore stories about tea and the people who grow it",
          "Discover the farmers behind your cup",
        ],
        ctaText: "Start Exploring",
        ctaUrl: `${SITE_URL}/en`,
        footerNote: "Questions? Email us at info@elxea.com",
      }
    : {
        greeting: `${data.customerName} 様`,
        headline: "roji by elxea へようこそ",
        intro:
          "会員登録いただき、ありがとうございます。roji は、日本各地の茶農家が丹精込めて育てたスペシャルティティーを、直接お届けするお茶のブランドです。",
        listTitle: "会員として、以下をお楽しみいただけます：",
        items: [
          "厳選されたスペシャルティティーのご購入",
          "季節のお茶が届く定期便へのご加入",
          "お茶と農家の物語を綴るジャーナルの閲覧",
          "お茶を育てた農家の方々のご紹介",
        ],
        ctaText: "さっそく見てみる",
        ctaUrl: `${SITE_URL}/ja`,
        footerNote:
          "ご不明な点は info@elxea.com までお気軽にお問い合わせください。",
      };

  const listItems = content.items
    .map(
      (item) =>
        `<li style="padding: 6px 0; font-size: 14px; color: #555; line-height: 1.6;">${item}</li>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "ja"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FFFEF2; font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 40px;">
      <p style="font-size: 14px; letter-spacing: 2px; color: #1a1a1a; margin: 0;">roji by elxea</p>
    </div>

    <!-- Content -->
    <div style="background-color: #ffffff; padding: 40px 32px; border: 1px solid #e8e8e8;">
      <!-- Greeting -->
      <p style="font-size: 14px; color: #1a1a1a; margin: 0 0 8px;">
        ${content.greeting}
      </p>

      <!-- Headline -->
      <h1 style="font-size: 22px; font-weight: 400; color: #1a1a1a; margin: 0 0 24px; letter-spacing: 0.5px; line-height: 1.4;">
        ${content.headline}
      </h1>

      <!-- Intro -->
      <p style="font-size: 14px; color: #555; line-height: 1.8; margin: 0 0 28px;">
        ${content.intro}
      </p>

      <!-- Divider -->
      <div style="border-top: 1px solid #f0f0f0; margin: 0 0 28px;"></div>

      <!-- Feature list -->
      <p style="font-size: 12px; color: #888; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1px;">
        ${content.listTitle}
      </p>
      <ul style="margin: 0 0 32px; padding-left: 20px;">
        ${listItems}
      </ul>

      <!-- CTA -->
      <div style="text-align: center; margin-bottom: 28px;">
        <a href="${content.ctaUrl}"
           style="display: inline-block; padding: 14px 40px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 13px; letter-spacing: 2px;">
          ${content.ctaText}
        </a>
      </div>

      <!-- Footer note -->
      <p style="font-size: 12px; color: #888; line-height: 1.8; margin: 0; text-align: center;">
        ${content.footerNote}
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

export async function sendWelcomeEmail(
  data: WelcomeEmailData
): Promise<{ success: boolean; error?: string }> {
  if (!env("RESEND_API_KEY")) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const text = buildTextEmail(data);
  const html = buildHtmlEmail(data);

  const subject =
    data.locale === "en"
      ? "Welcome to roji by elxea"
      : "【roji】ご登録ありがとうございます";

  const { error } = await getResend().emails.send({
    from: `roji by elxea <${FROM_EMAIL}>`,
    to: [data.customerEmail],
    subject,
    text,
    html,
  });

  if (error) {
    console.error("[Welcome Email] Resend error:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
