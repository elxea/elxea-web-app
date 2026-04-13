/**
 * Tests for the shared Zod validation helpers used by POST API routes.
 * Covers parseJsonBody and formatZodError against the full set of failure
 * modes (invalid JSON, schema violation, edge cases).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { NextRequest } from "next/server";
import { parseJsonBody, formatZodError } from "@/lib/validation/zod-helpers";

function makeRequest(body: unknown): NextRequest {
  // NextRequest wraps the native Request with URL + nextUrl.
  return new NextRequest("https://example.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TestSchema = z.object({
  name: z.string().min(1).max(50),
  email: z.string().email(),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(["admin", "user"]),
});

describe("parseJsonBody", () => {
  it("returns ok:true with parsed data on a valid body", async () => {
    const req = makeRequest({
      name: "Alice",
      email: "alice@example.com",
      age: 30,
      role: "admin",
    });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Alice");
      expect(result.data.email).toBe("alice@example.com");
      expect(result.data.age).toBe(30);
      expect(result.data.role).toBe("admin");
    }
  });

  it("allows optional fields to be omitted", async () => {
    const req = makeRequest({
      name: "Bob",
      email: "bob@example.com",
      role: "user",
    });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.age).toBeUndefined();
    }
  });

  it("returns 400 on invalid JSON", async () => {
    const req = makeRequest("{not valid json");
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("Invalid JSON body");
    }
  });

  it("returns 400 on schema violation (missing required field)", async () => {
    const req = makeRequest({ name: "Carol", role: "admin" });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("Invalid request body");
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.some((d: { path: string }) => d.path === "email")).toBe(true);
    }
  });

  it("returns 400 on invalid email format", async () => {
    const req = makeRequest({
      name: "Dave",
      email: "not-an-email",
      role: "user",
    });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.details.some((d: { path: string }) => d.path === "email")).toBe(true);
    }
  });

  it("returns 400 when a string exceeds max length", async () => {
    const req = makeRequest({
      name: "x".repeat(51),
      email: "ok@example.com",
      role: "user",
    });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
  });

  it("returns 400 on invalid enum value", async () => {
    const req = makeRequest({
      name: "Eve",
      email: "eve@example.com",
      role: "superuser",
    });
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.details.some((d: { path: string }) => d.path === "role")).toBe(true);
    }
  });

  it("does not echo the raw rejected user input back in the error details", async () => {
    const sensitivePayload = {
      name: "Mallory",
      email: "malicious-but-should-not-be-echoed",
      role: "admin",
    };
    const req = makeRequest(sensitivePayload);
    const result = await parseJsonBody(req, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      // Details should describe path/code/message only, not include the raw
      // submitted value verbatim.
      const detailsJson = JSON.stringify(body.details);
      expect(detailsJson).not.toContain("malicious-but-should-not-be-echoed");
    }
  });

  it("handles deeply nested schema violations", async () => {
    const NestedSchema = z.object({
      user: z.object({
        profile: z.object({
          name: z.string().min(1),
        }),
      }),
    });
    const req = makeRequest({ user: { profile: { name: "" } } });
    const result = await parseJsonBody(req, NestedSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.details[0].path).toBe("user.profile.name");
    }
  });
});

describe("formatZodError", () => {
  it("returns an array of {path, code, message}", () => {
    const schema = z.object({ foo: z.string() });
    const result = schema.safeParse({ foo: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted[0]).toHaveProperty("path");
      expect(formatted[0]).toHaveProperty("code");
      expect(formatted[0]).toHaveProperty("message");
    }
  });

  it("joins nested paths with dots", () => {
    const schema = z.object({ a: z.object({ b: z.object({ c: z.string() }) }) });
    const result = schema.safeParse({ a: { b: { c: 1 } } });
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted[0]!.path).toBe("a.b.c");
    }
  });
});
