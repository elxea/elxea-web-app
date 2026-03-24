"use client";

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
  const { messages } = useChatContext();

  // Already shown this session
  if (wasCTAShown()) return null;

  // Not enough turns yet
  const turns = countTurns(messages);
  if (turns < MIN_TURNS) return null;

  // Mark as shown so it only appears once per session
  markCTAShown();

  return (
    <div
      data-slot="tasting-note-cta"
      className="flex items-start"
    >
      <Link
        href="/tasting-note"
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      >
        体験を記録する →
      </Link>
    </div>
  );
}
