import { NextRequest, NextResponse } from "next/server";
import { z, ZodError, ZodType } from "zod";

/**
 * Shared helpers for validating API route request bodies with Zod.
 *
 * These helpers:
 *   - centralize JSON parsing + validation
 *   - return a sanitized error shape so internal schema details never leak
 *   - throw 400 on invalid JSON or schema violation
 */

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Format a ZodError into a safe, stable shape for HTTP 400 responses.
 * We intentionally omit raw `received` values because they may echo user
 * input that could contain sensitive data.
 */
export function formatZodError(error: ZodError): Array<{
  path: string;
  code: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns `{ ok: true, data }` on success or `{ ok: false, response }` with a
 * 400 NextResponse on failure.
 */
export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T>
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      ),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body", details: formatZodError(parsed.error) },
        { status: 400 }
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

// Re-export `z` for ergonomic imports in routes.
export { z };
