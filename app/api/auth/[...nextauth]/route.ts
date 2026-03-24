/**
 * Auth.js v5 API route handler.
 *
 * Handles /api/auth/signin, /api/auth/callback/line, /api/auth/signout, etc.
 * Existing Shopify OAuth routes (/api/auth/login, /api/auth/callback)
 * are handled by their own route files and are NOT affected by this catch-all
 * because Next.js static routes take priority over catch-all routes.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
