"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useBottomStackSlot } from "@/hooks/use-bottom-stack-slot";
import type { ConsentChoice } from "@/lib/consent";
import {
  setConsentChoice,
  useConsentBannerForcedOpen,
  useConsentChoice,
} from "@/lib/consent-store";
import { cn } from "@/lib/utils";

/**
 * Cookie consent banner.
 *
 * Visible only when the visitor has no valid choice on record, or when they
 * re-opened it from the footer to change their mind. The choice itself lives in
 * `lib/consent.ts`; the shared store in `lib/consent-store.ts` is what lets the
 * GTM container react to a click here without a page reload.
 */
export function CookieConsent() {
  const t = useTranslations("cookie");
  const choice = useConsentChoice();
  const forcedOpen = useConsentBannerForcedOpen();

  // "unknown" is the server / pre-hydration state. Rendering the banner then
  // would flash it on every page load for visitors who already chose.
  const visible = choice !== "unknown" && (choice === null || forcedOpen);

  // 自分が下端で占めている高さを公開する。上に載る面 (イベント申込バー /
  // チャットランチャ / PC のチャット入力バー) がこの分だけ自分を持ち上げる。
  // 公開しないと、それらが同意バーに重なって「詳しく見る」等が押せなくなる
  // (2026-08-18 QA 実測の回帰。詳細は hooks/use-bottom-stack-slot.ts)。
  //
  // 高さは実測して公開する: `sm` 未満では 2 段組に折り返して背が高くなるため、
  // 定数を置くと最も余白の無いビューポートでだけ値が狂う。
  const barRef = useRef<HTMLDivElement>(null);
  useBottomStackSlot(barRef, "--consent-bar-h", visible);

  if (!visible) return null;

  const choose = (next: ConsentChoice) => {
    const previous = choice;
    setConsentChoice(next);
    // Withdrawing consent has to take effect now, not on the next navigation:
    // once the GTM container has booted, unmounting the <Script> cannot unload
    // it. A reload is the only reliable way to get back to an untagged page.
    if (previous === "all" && next === "essential") {
      window.location.reload();
    }
  };

  return (
    // 音声プレイヤーのバー (components/audio/audio-dock.tsx) が出ている間は
    // その分だけ上へ退く。重ねると同意ボタンが隠れて押せなくなる。非表示時は
    // 0px で従来の位置。
    //
    // z は名前付きレイヤー (`app/globals.css` の `--z-*` が唯一の SoT)。音声バー
    // と同じ「画面端に貼り付く常設面」= `--z-sticky` (1020)。互いに重ならない
    // (上の bottom で縦に積む) ので同じ段でよく、出入りの一瞬だけ重なったときは
    // DOM 順で後ろに居るこちらが前に出る (レイアウトの並びが AudioDock →
    // CookieConsent)。生の `z-50` は 1020 に必ず負けていたので使わない。
    <div
      ref={barRef}
      // 下端に居座る面は e2e で矩形を実測して重なりを検査する
      // (`e2e/mobile.spec.ts` の Bottom-fixed occlusion)。class 名は Tailwind の
      // 都合で変わるので、掴む先は data-slot に固定する。
      data-slot="cookie-consent"
      style={{ bottom: "var(--audio-bar-h, 0px)" }}
      className={cn(
        "fixed left-0 right-0 z-(--z-sticky) w-full max-w-full border-t border-border bg-background",
        // 音声バーが出入りするときの退避はスライドではなく滑らかに。ChatBar に
        // だけ入っていた指定をここにも広げて、3つの下端要素の挙動を揃える。
        "transition-[bottom] duration-fast ease-enter",
        "animate-rise"
      )}
    >
      {/* 統合 (2026-08-17): 同意の中身は main 版 (lib/consent + consent-store 経由で
          GTM に伝わる版) を採り、内側の幅取りだけ c1-ds のデザインシステムの
          `.page-container` に載せ替えた。ハードコードの `max-w-7xl px-6` を残すと
          ページ余白トークン (--page-margin) から外れる。 */}
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
          <Button variant="outline" size="sm" onClick={() => choose("essential")}>
            {t("decline")}
          </Button>
          <Button size="sm" onClick={() => choose("all")}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
