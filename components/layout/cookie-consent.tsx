"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  // 退出の動きを見せてから消すための「閉じかけ」。選択自体はボタンを押した
  // 時点で保存し、DOM から外すのだけを `animationend` まで遅らせる。
  const [closing, setClosing] = useState(false);
  const visible = needsConsent && !dismissed;

  const handleAccept = () => {
    localStorage.setItem("cookie-consent", "all");
    setClosing(true);
  };

  const handleDecline = () => {
    localStorage.setItem("cookie-consent", "essential");
    setClosing(true);
  };

  const handleAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    // 子要素のアニメーションが上がってくるので、自分の分だけ拾う。
    if (!closing || event.target !== event.currentTarget) return;
    setDismissed(true);
  };

  if (!visible) return null;

  return (
    // 音声プレイヤーのバー (components/audio/audio-dock.tsx) が出ている間は
    // その分だけ上へ退く。z では音声バーが前 (1020 > 50) なので、重ねると
    // 同意ボタンが隠れて押せなくなる。非表示時は 0px で従来の位置。
    <div
      style={{ bottom: "var(--audio-bar-h, 0px)" }}
      onAnimationEnd={handleAnimationEnd}
      className={cn(
        "fixed left-0 right-0 z-50 w-full max-w-full border-t border-border bg-background",
        // 音声バーが出入りするときの退避はスライドではなく滑らかに。ChatBar に
        // だけ入っていた指定をここにも広げて、3つの下端要素の挙動を揃える。
        "transition-[bottom] duration-fast ease-enter",
        closing ? "animate-recede" : "animate-rise"
      )}
    >
      <div className="page-container py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-muted-foreground flex-1 min-w-0 break-words">
          {t("message")}{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-foreground transition-colors"
          >
            {t("learnMore")}
          </Link>
        </p>
        <div className="flex flex-wrap gap-3">
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
