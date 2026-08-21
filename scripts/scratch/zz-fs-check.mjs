// Read-only Firestore verification for test orders #1102 / #1103
import { readFileSync } from "node:fs";
import admin from "firebase-admin";

const APP = "/Users/setaka/github/elxea/products/elxea-web-app";
function loadEnv(p) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv(`${APP}/.env.local`);
loadEnv(`${APP}/.env`);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID.trim(),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

const CUSTOMER = "5898634526878";
const ORDERS = ["6863489138846", "6863490810014"];

const out = {};

// 1) order mirrors
out.orderMirrors = {};
for (const oid of ORDERS) {
  const snap = await db.collection("users").doc(CUSTOMER).collection("orders").doc(oid).get();
  out.orderMirrors[oid] = snap.exists ? snap.data() : null;
}

// 1b) all order docs for this customer (duplicate detection)
const allOrders = await db.collection("users").doc(CUSTOMER).collection("orders").get();
out.allOrderDocIds = allOrders.docs.map((d) => d.id);

// 2) behaviorLog recent
const bl = await db
  .collection("users").doc(CUSTOMER).collection("behaviorLog")
  .orderBy("createdAt", "desc").limit(10).get();
out.behaviorLog = bl.docs.map((d) => ({ id: d.id, ...d.data() }));

// 3) user doc
const u = await db.collection("users").doc(CUSTOMER).get();
out.user = u.exists ? u.data() : null;

// 4) webhook logs (idempotency ledger) — recent
try {
  const wl = await db.collection("_webhookLogs").orderBy("processedAt", "desc").limit(25).get();
  out.webhookLogs = wl.docs.map((d) => ({ id: d.id, ...d.data() }));
} catch (e) {
  try {
    const wl = await db.collection("_webhookLogs").limit(50).get();
    out.webhookLogsFallback = wl.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e2) {
    out.webhookLogsError = String(e2);
  }
}

// 5) subscription collections if any
for (const c of ["subscriptions", "subscriptionContracts", "_billingRuns", "billingAttempts"]) {
  try {
    const s = await db.collection(c).limit(10).get();
    out[`col_${c}`] = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    out[`col_${c}`] = `ERR ${String(e).slice(0, 120)}`;
  }
}

// 6) root collections
const cols = await db.listCollections();
out.rootCollections = cols.map((c) => c.id);

console.log(JSON.stringify(out, null, 2));
process.exit(0);
