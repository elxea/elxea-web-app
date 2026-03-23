"use client";

import { cn } from "@/lib/utils";
import { useAudio } from "@/components/audio/audio-provider";

type AudioToggleProps = {
  className?: string;
};

export function AudioToggle({ className }: AudioToggleProps) {
  const { isPlaying, toggle } = useAudio();

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "flex flex-col items-end gap-0 text-muted-foreground hover:text-foreground transition-colors duration-200",
        className
      )}
      aria-label={isPlaying ? "Pause background music" : "Play background music"}
    >
      <span className="text-xs tracking-widest uppercase leading-none">
        {isPlaying ? "pause" : "play"}
      </span>
      <span className="text-xs tracking-wide leading-none mt-0.5 text-muted-foreground/70">
        elxea tea time mix
      </span>
    </button>
  );
}
