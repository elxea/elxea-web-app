"use client";

import type { QuickReplyItem } from "./elxea-chat-transport";
import { cn } from "@/lib/utils";

interface QuickRepliesProps {
  items: QuickReplyItem[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function QuickReplies({ items, onSelect, disabled }: QuickRepliesProps) {
  if (items.length === 0) return null;

  return (
    <div
      data-slot="quick-replies"
      className="flex flex-wrap gap-2 w-full"
    >
      {items.map((item, i) => (
        <button
          key={`${item.text}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(item.text)}
          className={cn(
            "rounded-full border border-primary/30 bg-background px-3 py-1.5",
            "text-xs text-primary font-medium",
            "hover:bg-primary/5 hover:border-primary/50 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
