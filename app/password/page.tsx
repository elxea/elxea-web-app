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
    <div className="min-h-screen flex items-center justify-center font-sans bg-background">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 w-80"
      >
        <h1 className="text-lg font-normal text-foreground text-center">
          elxea
        </h1>
        <p className="text-[13px] text-muted-foreground text-center">
          This site is password protected.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="px-3 py-2.5 border border-border bg-popover text-sm outline-none"
        />
        {error && (
          <p className="text-[13px] text-destructive m-0">
            Incorrect password.
          </p>
        )}
        <button
          type="submit"
          className="py-2.5 bg-primary text-primary-foreground border-none text-sm cursor-pointer"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
