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
const TO_EMAIL = process.env.CONTACT_TO_EMAIL || "support@elxea.com";

const ContactFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
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
    const { name, email, subject, message } = parsed.data;

    const { error } = await getResend().emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: [TO_EMAIL],
      replyTo: email,
      subject: `[お問い合わせ] ${subject}`,
      text: `名前: ${name}\nメール: ${email}\n件名: ${subject}\n\n${message}`,
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
