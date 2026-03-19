import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@elxea.com";
const TO_EMAIL = process.env.CONTACT_BUSINESS_TO_EMAIL || "info@elxea.com";

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  wholesale: "卸売について",
  press: "PR・メディア掲載",
  other: "その他",
};

export async function POST(request: NextRequest) {
  try {
    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { companyName, name, email, inquiryType, message } = body;

    if (!companyName || !name || !email || !inquiryType || !message) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const inquiryLabel = INQUIRY_TYPE_LABELS[inquiryType] || inquiryType;

    const resend = new Resend(RESEND_API_KEY);

    await resend.emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: email,
      subject: `[法人お問い合わせ] ${inquiryLabel}: ${companyName}`,
      text: `会社名: ${companyName}\n担当者名: ${name}\nメール: ${email}\n用件種別: ${inquiryLabel}\n\n${message}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Business contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
