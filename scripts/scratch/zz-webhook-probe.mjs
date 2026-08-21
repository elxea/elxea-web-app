// Read-only diagnostic: verify that production's SHOPIFY_WEBHOOK_SECRET matches
// the local one, WITHOUT causing any Firestore write.
//
// Method: sign a payload that passes HMAC but fails Zod schema validation.
//   - HMAC ok   -> handler proceeds, schema rejects  -> 400 {"error":"Invalid payload"}
//   - HMAC bad  -> 401 {"error":"Unauthorized"}
// The 400 branch returns before any Firestore access, so nothing is written.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const APP = "/Users/setaka/github/elxea/products/elxea-web-app";
function loadEnv(p) {
  const o = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}
const e = loadEnv(`${APP}/.env.local`);
const secret = e.SHOPIFY_WEBHOOK_SECRET;
if (!secret) throw new Error("SHOPIFY_WEBHOOK_SECRET missing locally");

const body = JSON.stringify({ __probe: "schema-fail-on-purpose" });
const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
const ts = Math.floor(Date.now() / 1000);

const res = await fetch("https://elxea.com/api/webhooks/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Hmac-SHA256": hmac,
    "X-Shopify-Topic": "orders/create",
    "X-Shopify-Webhook-Id": `local-probe-${ts}`,
    "X-Shopify-Webhook-Timestamp": String(ts),
  },
  body,
});
console.log("status:", res.status, "body:", await res.text());
console.log(
  "local_secret_shape:",
  secret.length,
  "chars,",
  /^shpss_/.test(secret) ? "shpss_ prefixed" : /^[0-9a-f]+$/.test(secret) ? "hex" : "other",
);
