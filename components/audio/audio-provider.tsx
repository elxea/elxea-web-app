"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type AudioContextValue = {
  isPlaying: boolean;
  toggle: () => void;
};

const AudioContext = createContext<AudioContextValue>({
  isPlaying: false,
  toggle: () => {},
});

const STORAGE_KEY = "elxea-bgm-playing";

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio("/audio/bgm.mp3");
    audio.loop = true;
    audio.volume = 0.3;
    audio.preload = "none";
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().then(() => {
        setIsPlaying(true);
        try {
          localStorage.setItem(STORAGE_KEY, "true");
        } catch {}
      }).catch(() => {
        // Browser blocked autoplay — user interaction required
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      try {
        localStorage.setItem(STORAGE_KEY, "false");
      } catch {}
    }
  }, []);

  return (
    <AudioContext.Provider value={{ isPlaying, toggle }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  return useContext(AudioContext);
}
