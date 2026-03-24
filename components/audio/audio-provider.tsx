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

const POSITION_KEY = "elxea-bgm-position";

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio("/audio/bgm.mp3");
    audio.loop = true;
    audio.volume = 0.3;
    audio.preload = "none";

    // Restore saved playback position once metadata is loaded.
    // Setting currentTime before loadedmetadata is a no-op on many browsers.
    const handleLoadedMetadata = () => {
      try {
        const savedPosition = localStorage.getItem(POSITION_KEY);
        if (savedPosition) {
          const pos = parseFloat(savedPosition);
          if (!isNaN(pos) && pos > 0 && pos < audio.duration) {
            audio.currentTime = pos;
          }
        }
      } catch {}
    };
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    audioRef.current = audio;

    // 再生位置を5秒ごとに保存
    const saveInterval = setInterval(() => {
      if (audio && !audio.paused && isFinite(audio.currentTime)) {
        try {
          localStorage.setItem(POSITION_KEY, String(audio.currentTime));
        } catch {}
      }
    }, 5000);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      // 離脱時に最終位置を保存
      if (audio && isFinite(audio.currentTime)) {
        try {
          localStorage.setItem(POSITION_KEY, String(audio.currentTime));
        } catch {}
      }
      clearInterval(saveInterval);
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
      }).catch(() => {
        // Browser blocked autoplay — user interaction required
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      try {
        localStorage.setItem(POSITION_KEY, String(audio.currentTime));
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
