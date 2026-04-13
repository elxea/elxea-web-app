"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

function subscribeToConsent(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getConsentSnapshot(): boolean {
  return !localStorage.getItem("cookie-consent");
}

function getServerConsentSnapshot(): boolean {
  return false;
}

export function CookieConsent() {
  const t = useTranslations("cookie");
  const needsConsent = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    getServerConsentSnapshot
  );
  const [dismissed, setDismissed] = useState(false);
  const visible = needsConsent && !dismissed;

  const handleAccept = () => {
    localStorage.setItem("cookie-consent", "all");
    setDismissed(true);
  };

  const handleDecline = () => {
    localStorage.setItem("cookie-consent", "essential");
    setDismissed(true);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-muted-foreground flex-1">
          {t("message")}{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-foreground transition-colors"
          >
            {t("learnMore")}
          </Link>
        </p>
        <div className="flex gap-3 shrink-0">
          <Button variant="outline" size="sm" onClick={handleDecline}>
            {t("decline")}
          </Button>
          <Button size="sm" onClick={handleAccept}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
