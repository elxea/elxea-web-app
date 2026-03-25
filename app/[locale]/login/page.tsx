/**
 * Login page with LINE Login and Shopify OAuth options.
 *
 * LINE Login is the primary CTA (direct OAuth via /api/line-login).
 * Shopify OAuth is retained for users who already have a Shopify account.
 *
 * Session integration flow:
 * 1. LineLoginButton saves chat session_id to cookie (client-side)
 * 2. /api/line-callback exchanges code for tokens and links identity
 * 3. After redirect, LinkSuccessBanner shows confirmation
 */
import { Suspense } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LineLoginButton } from "./line-login-button";
import { LinkSuccessBanner } from "./link-success-banner";
import { AuthErrorBanner } from "./auth-error-banner";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return {
    title: t("title"),
  };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  const locale = await getLocale();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-8">
        {/* P2-fix: Error banner for failed authentication attempts */}
        <Suspense fallback={null}>
          <AuthErrorBanner />
        </Suspense>

        {/* Success banner after LINE Login */}
        <Suspense fallback={null}>
          <LinkSuccessBanner />
        </Suspense>

        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="font-heading text-2xl tracking-tight">
            {t("heading")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {/* LINE Login — primary action */}
        <LineLoginButton>
          <LineIcon />
          {t("lineButton")}
        </LineLoginButton>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("or")}</span>
          <Separator className="flex-1" />
        </div>

        {/* Shopify OAuth — secondary option */}
        <Button variant="outline" size="lg" className="w-full" asChild>
          <a href={`/api/auth/login?locale=${locale}`}>
            {t("shopifyButton")}
          </a>
        </Button>

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground leading-relaxed">
          {t("terms")}
        </p>
      </div>
    </div>
  );
}

/** LINE brand icon (simplified SVG) */
function LineIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 5.83 2 10.5c0 4.08 3.32 7.5 7.8 8.32.3.07.72.21.82.48.1.24.06.63.03.87l-.13.8c-.04.24-.19.94.82.51s5.47-3.22 7.46-5.52C20.92 13.5 22 12.08 22 10.5 22 5.83 17.52 2 12 2zm-3.43 11.13H6.35a.53.53 0 01-.53-.53V8.07c0-.3.24-.53.53-.53s.53.24.53.53v4h1.69c.3 0 .53.24.53.53s-.24.53-.53.53zm1.79-.53a.53.53 0 01-1.06 0V8.07a.53.53 0 011.06 0v4.53zm4.52 0a.53.53 0 01-.38.51.53.53 0 01-.55-.17l-2.3-3.13v2.79a.53.53 0 01-1.06 0V8.07c0-.22.14-.42.34-.5a.53.53 0 01.59.13l2.3 3.14V8.07a.53.53 0 011.06 0v4.53zm3.15-3.47a.53.53 0 010 1.06h-1.69v1.17h1.69a.53.53 0 010 1.06h-2.22a.53.53 0 01-.53-.53V8.07c0-.3.24-.53.53-.53h2.22a.53.53 0 010 1.06h-1.69v1.06h1.69z" />
    </svg>
  );
}
