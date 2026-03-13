"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "#333",
          color: "#fff",
          border: "none",
          borderRadius: 0,
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
        },
      }}
    />
  );
}
