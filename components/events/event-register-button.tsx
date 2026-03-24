"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type EventRegisterButtonProps = {
  /** Sanity event slug — used as eventSlug in Firestore */
  eventSlug: string;
  /** Event title — stored for my-page display */
  eventTitle: string;
  /** Event date ISO string — stored for my-page display */
  eventDate: string | null;
  /** Event image URL — stored for my-page display */
  eventImageUrl: string | null;
  /** Label when not registered */
  registerLabel: string;
  /** Label when already registered */
  cancelLabel: string;
  /** Toast message on register */
  registeredMessage: string;
  /** Toast message on cancel */
  cancelledMessage: string;
  /** Error toast message */
  errorMessage: string;
  /** Login required toast message */
  loginRequiredMessage: string;
  /** Optional className */
  className?: string;
};

export function EventRegisterButton({
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
  className,
}: EventRegisterButtonProps) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  // Check initial registration status
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/user/events?check=${encodeURIComponent(eventSlug)}`
        );
        if (!res.ok) return; // Not logged in — silently ignore
        const data = await res.json();
        if (!cancelled) {
          setIsRegistered(data.registered === true);
          setIsChecked(true);
        }
      } catch {
        // Silently fail
      }
    }

    if (typeof document !== "undefined" && document.cookie.includes("shop_auth=1")) {
      checkStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  const handleClick = useCallback(async () => {
    if (typeof document !== "undefined" && !document.cookie.includes("shop_auth=1")) {
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

  return (
    <Button
      variant={isRegistered ? "outline" : "default"}
      size="sm"
      onClick={handleClick}
      disabled={isLoading}
      aria-label={isRegistered ? cancelLabel : registerLabel}
      aria-pressed={isRegistered}
      className={cn(
        "gap-2 transition-all duration-200",
        isChecked ? "opacity-100" : "opacity-80",
        className
      )}
    >
      {isRegistered ? (
        <CalendarCheck className="size-4" />
      ) : (
        <CalendarPlus className="size-4" />
      )}
      {isRegistered ? cancelLabel : registerLabel}
    </Button>
  );
}
