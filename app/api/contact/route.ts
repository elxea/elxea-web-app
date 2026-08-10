import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters, getClientIp } from "@/lib/ratelimit";

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

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@elxea.com";
// 既定の受信先は info@ に統一 (Setaka 確定 2026-08-11)。画面に出す問い合わせ先と
// 実際の受信箱が別アドレスだと、返信元と案内先が食い違う。
const TO_EMAIL = process.env.CONTACT_TO_EMAIL || "info@elxea.com";
const BUSINESS_TO_EMAIL = process.env.CONTACT_BUSINESS_TO_EMAIL || "info@elxea.com";

/**
 * お問い合わせの種類。Figma【R2: 確定版】`8109:46695` の 2 択に対応する。
 *
 * R2 で法人ページが `/contact` に統合されたため、R1 で URL (`/contact/business`)
 * が担っていた「どのメールボックスへ送るか」の振り分けをこの軸に移した。
 * 送信先は R1 と同じ 2 つ (一般 = CONTACT_TO_EMAIL / 法人 = CONTACT_BUSINESS_TO_EMAIL)。
 */
const CATEGORY_ROUTING = {
  customer: { to: TO_EMAIL, label: "お問い合わせ" },
  business: { to: BUSINESS_TO_EMAIL, label: "お取引・取材等のご相談" },
} as const;

const ContactFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  // R2 で `件名` field が廃止されたため任意にした (旧クライアントからの送信は引き続き通る)。
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(5000),
  // 未選択のまま送れる項目なので任意。既定は一般問い合わせ。
  category: z.enum(["customer", "business"]).default("customer"),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limit by client IP: 10 req/hour
    const limited = await enforceRateLimit(request, limiters.contactForm, getClientIp(request));
    if (limited) return limited;

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 503 }
      );
    }

    const parsed = await parseJsonBody(request, ContactFormSchema);
    if (!parsed.ok) return parsed.response;
    const { name, email, subject, message, category } = parsed.data;
    const routed = CATEGORY_ROUTING[category];

    // 件名は R2 で廃止された任意項目。無いときは種類ラベルだけで件名を組む
    // (「データが無い行は出さない」= 空の `件名:` を本文に残さない)。
    const mailSubject = subject
      ? `[${routed.label}] ${subject}`
      : `[${routed.label}] ${name}`;

    const { error } = await getResend().emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: [routed.to],
      replyTo: email,
      subject: mailSubject,
      text: [
        `種類: ${routed.label}`,
        `名前: ${name}`,
        `メール: ${email}`,
        ...(subject ? [`件名: ${subject}`] : []),
        "",
        message,
      ].join("\n"),
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
