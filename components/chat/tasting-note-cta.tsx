"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatContext } from "./chat-provider";
import { Link } from "@/i18n/navigation";

// ---------------------------------------------------------------------------
// Tasting Note CTA
//
// 5 turns (= 5 assistant messages) 以上の会話後に、
// テイスティングノート UI への導線を表示する。
// 1セッションにつき1回だけ表示（sessionStorage で制御）。
// ---------------------------------------------------------------------------

const TASTING_NOTE_CTA_KEY = "elxea-tasting-note-cta-shown";

/** Minimum number of assistant responses before showing the CTA. */
const MIN_TURNS = 5;

function wasCTAShown(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return sessionStorage.getItem(TASTING_NOTE_CTA_KEY) === "1";
  } catch {
    return false;
  }
}

function markCTAShown(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TASTING_NOTE_CTA_KEY, "1");
  } catch {
    // sessionStorage full or disabled
  }
}

/**
 * Count the number of assistant messages (= turns) in the messages array.
 */
function countTurns(messages: { role: string }[]): number {
  let turns = 0;
  for (const msg of messages) {
    if (msg.role === "assistant") {
      turns++;
    }
  }
  return turns;
}

export function TastingNoteCta() {
  const t = useTranslations("tastingNote");
  const { messages } = useChatContext();
  const [visible, setVisible] = useState(false);

  const turns = countTurns(messages);
  const shouldShow = !wasCTAShown() && turns >= MIN_TURNS;

  useEffect(() => {
    if (shouldShow) {
      markCTAShown();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time CTA visibility after async chat threshold
      setVisible(true);
    }
  }, [shouldShow]);

  if (!visible) return null;

  return (
    <div
      data-slot="tasting-note-cta"
      className="flex items-start"
    >
      <Link
        /* アンケートは /tasting-note から子ルートへ退避した (=/tasting-note は
           R2 の飲んだ記録一覧)。この CTA が指すのは従来どおりアンケート。 */
        href="/tasting-note/feedback"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      >
        {t("chatCta")}
      </Link>
    </div>
  );
}
