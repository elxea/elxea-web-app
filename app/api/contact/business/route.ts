import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { env } from "@/lib/config";
import { logger } from "@/lib/log";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters, getClientIp } from "@/lib/ratelimit";

const RESEND_API_KEY = env("RESEND_API_KEY");
const FROM_EMAIL = env("RESEND_FROM_EMAIL") ?? "no-reply@elxea.com";
const TO_EMAIL = env("CONTACT_BUSINESS_TO_EMAIL") ?? "info@elxea.com";

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  wholesale: "卸売について",
  press: "PR・メディア掲載",
  other: "その他",
};

const BusinessContactSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  inquiryType: z.enum(["wholesale", "press", "other"]),
  message: z.string().trim().min(1).max(5000),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limit by client IP: 10 req/hour
    const limited = await enforceRateLimit(request, limiters.contactForm, getClientIp(request));
    if (limited) return limited;

    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 503 }
      );
    }

    const parsed = await parseJsonBody(request, BusinessContactSchema);
    if (!parsed.ok) return parsed.response;
    const { companyName, name, email, inquiryType, message } = parsed.data;

    const inquiryLabel = INQUIRY_TYPE_LABELS[inquiryType] || inquiryType;

    const resend = new Resend(RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: email,
      subject: `[法人お問い合わせ] ${inquiryLabel}: ${companyName}`,
      text: `会社名: ${companyName}\n担当者名: ${name}\nメール: ${email}\n用件種別: ${inquiryLabel}\n\n${message}`,
    });

    if (error) {
      console.error("Business contact Resend error:", error);
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    /* 送れなかった問い合わせは顧客側から再送されない。無音にすると商談が
       そのまま消える。 */
    logger.error("api.contact-business.submit-failed", error, {
      route: "/api/contact/business",
      status: 500,
    });
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
