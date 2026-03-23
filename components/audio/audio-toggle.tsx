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
        "flex items-center gap-2 text-foreground transition-colors duration-200 cursor-pointer",
        className
      )}
      aria-label={isPlaying ? "Pause background music" : "Play background music"}
    >
      <span className="text-xs font-medium tracking-widest uppercase underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground">
        {isPlaying ? "pause" : "play"}
      </span>
      <span
        className={cn(
          "text-xs tracking-wide text-muted-foreground inline-block",
          isPlaying && "animate-spin-slow"
        )}
      >
        ✿
      </span>
      <span className="text-xs tracking-wide text-muted-foreground">
        sound from nature
      </span>
    </button>
  );
}
