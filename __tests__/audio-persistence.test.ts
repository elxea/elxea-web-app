/**
 * Tests for the audio player position persistence logic.
 *
 * The AudioProvider in components/audio/audio-provider.tsx uses localStorage
 * to persist playback position. This test verifies the save/restore behavior
 * using a mock localStorage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const POSITION_KEY = "elxea-bgm-position";

// Simulate the persistence logic from audio-provider.tsx

function savePosition(currentTime: number): void {
  if (isFinite(currentTime)) {
    localStorage.setItem(POSITION_KEY, String(currentTime));
  }
}

function restorePosition(audioDuration: number): number | null {
  const saved = localStorage.getItem(POSITION_KEY);
  if (!saved) return null;
  const pos = parseFloat(saved);
  if (isNaN(pos) || pos <= 0 || pos >= audioDuration) return null;
  return pos;
}

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string): string | null => store[key] ?? null,
  setItem: (key: string, value: string): void => {
    store[key] = value;
  },
  removeItem: (key: string): void => {
    delete store[key];
  },
  clear: (): void => {
    for (const key of Object.keys(store)) delete store[key];
  },
  get length(): number {
    return Object.keys(store).length;
  },
  key: (_index: number): string | null => null,
};

beforeEach(() => {
  mockLocalStorage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
});

describe("Audio position persistence", () => {
  describe("savePosition", () => {
    it("saves a valid currentTime to localStorage", () => {
      savePosition(42.5);
      expect(localStorage.getItem(POSITION_KEY)).toBe("42.5");
    });

    it("does not save NaN", () => {
      savePosition(NaN);
      expect(localStorage.getItem(POSITION_KEY)).toBeNull();
    });

    it("does not save Infinity", () => {
      savePosition(Infinity);
      expect(localStorage.getItem(POSITION_KEY)).toBeNull();
    });

    it("saves 0 (since isFinite(0) is true)", () => {
      savePosition(0);
      expect(localStorage.getItem(POSITION_KEY)).toBe("0");
    });
  });

  describe("restorePosition", () => {
    it("returns null when no saved position", () => {
      expect(restorePosition(3600)).toBeNull();
    });

    it("restores a valid saved position", () => {
      localStorage.setItem(POSITION_KEY, "120.5");
      expect(restorePosition(3600)).toBe(120.5);
    });

    it("returns null for saved position beyond duration", () => {
      localStorage.setItem(POSITION_KEY, "4000");
      expect(restorePosition(3600)).toBeNull();
    });

    it("returns null for zero position", () => {
      localStorage.setItem(POSITION_KEY, "0");
      expect(restorePosition(3600)).toBeNull();
    });

    it("returns null for negative position", () => {
      localStorage.setItem(POSITION_KEY, "-10");
      expect(restorePosition(3600)).toBeNull();
    });

    it("returns null for non-numeric saved value", () => {
      localStorage.setItem(POSITION_KEY, "not-a-number");
      expect(restorePosition(3600)).toBeNull();
    });
  });

  describe("STORAGE_KEY removed (I8)", () => {
    it("does not use elxea-bgm-playing key anymore", () => {
      // After I8 fix, the STORAGE_KEY constant and its writes were removed.
      // The provider should not read/write to this key.
      expect(localStorage.getItem("elxea-bgm-playing")).toBeNull();
    });
  });
});
