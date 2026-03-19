import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@elxea.com";
const TO_EMAIL =
  process.env.CONTACT_TO_EMAIL ||
  process.env.GMAIL_USER ||
  "info@elxea.com";

export async function POST(request: NextRequest) {
  try {
    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { name, email, subject, message } = body;

    if (!name || !email || !subject || !message) {
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

    const resend = new Resend(RESEND_API_KEY);

    await resend.emails.send({
      from: `elxea <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: email,
      subject: `[お問い合わせ] ${subject}`,
      text: `名前: ${name}\nメール: ${email}\n件名: ${subject}\n\n${message}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
