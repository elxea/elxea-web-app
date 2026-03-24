"use client";

/**
 * LIFF SDK Provider and hook.
 *
 * Handles LIFF initialization, LINE login, and profile retrieval.
 * Uses a mock implementation when NEXT_PUBLIC_LIFF_ID is not set (local dev).
 *
 * Mock behavior:
 *   - Returns a fixed LINE user ID for local testing
 *   - Allows the full linking flow to run without a real LINE environment
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type LiffState =
  | { status: "idle" }
  | { status: "initializing" }
  | { status: "ready"; isLoggedIn: boolean }
  | { status: "error"; message: string };

type LiffContextValue = {
  state: LiffState;
  lineUserId: string | null;
  displayName: string | null;
  login: () => void;
  logout: () => void;
};

// --------------------------------------------------------------------------
// Context
// --------------------------------------------------------------------------

const LiffContext = createContext<LiffContextValue | null>(null);

// --------------------------------------------------------------------------
// Mock helpers (used when LIFF_ID is absent — local dev)
// --------------------------------------------------------------------------

const MOCK_LINE_USER_ID = "Udeadbeefdeadbeefdeadbeefdeadbeef";
const MOCK_DISPLAY_NAME = "Mock LINE User";

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiffState>({ status: "idle" });
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const isMock = !liffId;

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (isMock) {
      // Mock mode: simulate ready + logged-in for local dev
      setState({ status: "ready", isLoggedIn: true });
      setLineUserId(MOCK_LINE_USER_ID);
      setDisplayName(MOCK_DISPLAY_NAME);
      return;
    }

    setState({ status: "initializing" });

    import("@line/liff")
      .then(async (liffModule) => {
        const liff = liffModule.default;
        try {
          await liff.init({ liffId });

          const loggedIn = liff.isLoggedIn();
          setState({ status: "ready", isLoggedIn: loggedIn });

          if (loggedIn) {
            const profile = await liff.getProfile();
            setLineUserId(profile.userId);
            setDisplayName(profile.displayName);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "LIFF init failed";
          setState({ status: "error", message: msg });
        }
      })
      .catch((err) => {
        setState({ status: "error", message: String(err) });
      });
  }, [isMock, liffId]);

  const login = useCallback(() => {
    if (isMock) return;
    import("@line/liff").then(({ default: liff }) => {
      liff.login();
    });
  }, [isMock]);

  const logout = useCallback(() => {
    if (isMock) return;
    import("@line/liff").then(({ default: liff }) => {
      liff.logout();
      setState({ status: "ready", isLoggedIn: false });
      setLineUserId(null);
      setDisplayName(null);
    });
  }, [isMock]);

  return (
    <LiffContext.Provider value={{ state, lineUserId, displayName, login, logout }}>
      {children}
    </LiffContext.Provider>
  );
}

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

export function useLiff(): LiffContextValue {
  const ctx = useContext(LiffContext);
  if (!ctx) {
    throw new Error("useLiff must be used inside <LiffProvider>");
  }
  return ctx;
}
