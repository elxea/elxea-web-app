/**
 * Resolve the application base URL from environment variables.
 *
 * Priority: NEXTAUTH_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL
 *
 * In production (NODE_ENV === "production"), throws if none are set.
 * In development, falls back to http://localhost:3000.
 */
export function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing base URL: set NEXTAUTH_URL, VERCEL_PROJECT_PRODUCTION_URL, or VERCEL_URL in production"
    );
  }

  return "http://localhost:3000";
}
