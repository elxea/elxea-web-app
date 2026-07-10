"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PasswordPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);

    const res = await fetch("/api/site-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 font-sans">
      {/* Card (変A / 認証フォームを枠付きカードに集約) */}
      <div className="w-full max-w-sm rounded-lg border border-border bg-card px-6 py-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 text-center">
            <h1 className="text-lg font-normal text-foreground">elxea</h1>
            <p className="text-sm text-muted-foreground">
              This site is password protected.
            </p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="border border-border bg-popover px-3 py-2.5 text-sm outline-none"
          />
          {error && (
            <p className="rounded-md border border-destructive/40 px-3 py-2 text-center text-sm text-destructive">
              Incorrect password.
            </p>
          )}
          <button
            type="submit"
            className="cursor-pointer border-none bg-primary py-2.5 text-sm text-primary-foreground"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
