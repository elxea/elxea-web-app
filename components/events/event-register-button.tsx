"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useBottomStackSlot } from "@/hooks/use-bottom-stack-slot";
import { cn } from "@/lib/utils";

/**
 * 参加登録 CTA。
 *
 * Figma【R2: 確定版】イベント詳細 6657:7931
 * - EventRegisterButton 6660:8003 (PC) / 6664:8164 (SP) …… カード内・全幅・h43・アイコン無し
 * - Sticky Register Bar 6664:13496 (SP のみ) …… 追従バー内に同じボタン
 *
 * R2 ではボタンが**同一ページに 2 つ**出る (カード内 + SP 追従バー) ため、登録状態を
 * `EventRegistrationProvider` に持ち上げて両方が同じ state を読む。ボタンごとに
 * fetch していた旧実装のままだと、片方を押しても他方のラベルが古いままになる。
 *
 * アイコンは R2 で廃止 (旧実装の lucide CalendarPlus / CalendarCheck を撤去)。
 */

function isAuthed() {
  if (typeof document === "undefined") return false;
  return (
    document.cookie.includes("shop_auth=1") ||
    document.cookie.includes("line_auth=1")
  );
}

type EventRegistrationLabels = {
  /** 未登録時のラベル */
  registerLabel: string;
  /** 登録済み時のラベル */
  cancelLabel: string;
  /** 登録完了トースト */
  registeredMessage: string;
  /** 解除完了トースト */
  cancelledMessage: string;
  /** 失敗トースト */
  errorMessage: string;
  /** 未ログイン時トースト */
  loginRequiredMessage: string;
};

type EventRegistrationValue = {
  isRegistered: boolean;
  isLoading: boolean;
  isChecked: boolean;
  label: string;
  toggle: () => void;
};

const EventRegistrationContext = createContext<EventRegistrationValue | null>(
  null,
);

function useEventRegistration(): EventRegistrationValue {
  const ctx = useContext(EventRegistrationContext);
  if (!ctx) {
    throw new Error(
      "EventRegisterButton must be rendered inside <EventRegistrationProvider>",
    );
  }
  return ctx;
}

export type EventRegistrationProviderProps = EventRegistrationLabels & {
  /** Sanity event slug — Firestore の eventSlug */
  eventSlug: string;
  /** マイページ表示用に保存するイベント名 */
  eventTitle: string;
  /** マイページ表示用に保存する開催日 (ISO) */
  eventDate: string | null;
  /** マイページ表示用に保存する画像 URL */
  eventImageUrl: string | null;
  children: React.ReactNode;
};

/** 登録状態を 1 か所に持つ Provider。ページ側で登録 CTA 群を包む。 */
export function EventRegistrationProvider({
  eventSlug,
  eventTitle,
  eventDate,
  eventImageUrl,
  registerLabel,
  cancelLabel,
  registeredMessage,
  cancelledMessage,
  errorMessage,
  loginRequiredMessage,
  children,
}: EventRegistrationProviderProps) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  // 初期の登録状態を引く (未ログインは 401 で黙って諦める)
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/user/events?check=${encodeURIComponent(eventSlug)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setIsRegistered(data.registered === true);
          setIsChecked(true);
        }
      } catch {
        // 状態が引けないだけなので黙って未登録扱いのまま
      }
    }

    if (isAuthed()) {
      checkStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  const toggle = useCallback(async () => {
    if (!isAuthed()) {
      toast(loginRequiredMessage);
      return;
    }

    setIsLoading(true);

    try {
      if (isRegistered) {
        const res = await fetch("/api/user/events", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventSlug }),
        });

        if (!res.ok) throw new Error("Failed to cancel registration");

        setIsRegistered(false);
        toast(cancelledMessage);
      } else {
        const res = await fetch("/api/user/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventSlug,
            eventTitle,
            eventDate,
            eventImageUrl,
          }),
        });

        if (!res.ok) throw new Error("Failed to register");

        setIsRegistered(true);
        toast(registeredMessage);
      }
    } catch {
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [
    isRegistered,
    eventSlug,
    eventTitle,
    eventDate,
    eventImageUrl,
    registeredMessage,
    cancelledMessage,
    errorMessage,
    loginRequiredMessage,
  ]);

  const value = useMemo<EventRegistrationValue>(
    () => ({
      isRegistered,
      isLoading,
      isChecked,
      label: isRegistered ? cancelLabel : registerLabel,
      toggle,
    }),
    [isRegistered, isLoading, isChecked, cancelLabel, registerLabel, toggle],
  );

  return (
    <EventRegistrationContext.Provider value={value}>
      {children}
    </EventRegistrationContext.Provider>
  );
}

/**
 * 参加登録ボタン (Figma 6660:8003 / 6664:8164)。
 * 面 = primary・全幅・h43 (`size="cta"`)。登録済みは outline に反転する。
 */
export function EventRegisterButton({ className }: { className?: string }) {
  const { isRegistered, isLoading, isChecked, label, toggle } =
    useEventRegistration();

  return (
    <Button
      variant={isRegistered ? "outline" : "default"}
      size="cta"
      onClick={toggle}
      disabled={isLoading}
      aria-label={label}
      aria-pressed={isRegistered}
      className={cn(
        "w-full transition-all duration-fast",
        isChecked ? "opacity-100" : "opacity-80",
        className,
      )}
    >
      {label}
    </Button>
  );
}

/**
 * SP の追従登録バー (Figma Sticky Register Bar 6664:13496)。
 *
 * Figma は SP フレームの最下部に別枠として置いてある = 画面下に固定される追従
 * CTA。`hideWhenVisibleSelectors` に渡した要素が視界に入っている間は出さない。
 * ページ側は `#event-registration` (本来の登録カード = CTA が二重に見えるのを
 * 防ぐ) と `footer` (フッターに重なって最下部の表記を隠すのを防ぐ) を渡す。
 * ページ側に spacer を敷かないので Figma の実寸 (節間 gap / 下余白) を歪めない。
 */
export function EventStickyRegisterBar({
  hideWhenVisibleSelectors,
}: {
  hideWhenVisibleSelectors: string[];
}) {
  const [visible, setVisible] = useState(false);
  // 配列 prop は毎レンダーで別参照になるので、監視対象の同一性は文字列で見る
  // (登録状態が変わるたびに observer を張り直さないため)。
  const selectorKey = hideWhenVisibleSelectors.join(",");

  useEffect(() => {
    const targets = selectorKey
      .split(",")
      .map((selector) => document.querySelector(selector))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);

    if (targets.length === 0) return;

    const intersecting = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      setVisible(intersecting.size === 0);
    });

    for (const target of targets) observer.observe(target);

    return () => observer.disconnect();
  }, [selectorKey]);

  // 自分が下端で占めている高さを公開する (チャットランチャがこの分だけ上がる)。
  const barRef = useRef<HTMLDivElement>(null);
  useBottomStackSlot(barRef, "--event-bar-h", visible);

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      data-slot="event-sticky-register-bar"
      // 下に居る面 (音声バー / Cookie 同意) の高さぶん上へ退く。下端に貼り付いた
      // ままだと、音声再生中は申込ボタンがバーの裏に完全に隠れて押せない
      // (生の `z-40` は音声バーの 1020 に必ず負ける)。
      //
      // `--consent-bar-h` を足すのは 2026-08-18 の是正。同意バーと同じ
      // `bottom: var(--audio-bar-h)` に居たため両者が同スロットで重なり
      // (QA 実測 25350px^2)、DOM 順で前に来る同意バーに申込ボタンが覆われていた。
      // 積み順の正本は hooks/use-bottom-stack-slot.ts。
      style={{
        bottom: "calc(var(--audio-bar-h, 0px) + var(--consent-bar-h, 0px))",
      }}
      // z は名前付きレイヤー (`app/globals.css` の `--z-*` が唯一の SoT)。
      // 「画面端に貼り付く常設面」= `--z-sticky` (1020)。チャットのランチャ
      // (`--z-chat` = 1030) はこの上に出したいので同じ段に上げない。
      className="fixed inset-x-0 z-(--z-sticky) flex border-t border-border bg-card px-4 py-2.5 transition-[bottom] duration-fast ease-enter md:hidden"
    >
      <EventRegisterButton />
    </div>
  );
}
