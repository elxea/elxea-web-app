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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#FFFEF2",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          width: "320px",
        }}
      >
        <h1 style={{ fontSize: "18px", fontWeight: 400, color: "#333", textAlign: "center" }}>
          elxea
        </h1>
        <p style={{ fontSize: "13px", color: "#666", textAlign: "center" }}>
          This site is password protected.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            padding: "10px 12px",
            border: "1px solid #E5E3D8",
            background: "#fff",
            fontSize: "14px",
            outline: "none",
          }}
        />
        {error && (
          <p style={{ fontSize: "13px", color: "#c00", margin: 0 }}>
            Incorrect password.
          </p>
        )}
        <button
          type="submit"
          style={{
            padding: "10px",
            background: "#333",
            color: "#fff",
            border: "none",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Enter
        </button>
      </form>
    </div>
  );
}
