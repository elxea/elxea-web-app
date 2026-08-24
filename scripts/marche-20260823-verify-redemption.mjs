import { execFileSync } from "node:child_process";
import { openDb, nowIso } from "/Users/setaka/github/elxea/products/elxea-cdp/lib/db.mjs";

const CDP_DIR = "/Users/setaka/github/elxea/products/elxea-cdp";
const EVENT = "marche-20260823";
const TEST_CODE = "MARCHE0823-TESTPROBE"; // dedicated test-only code, NOT one of the 100 distributed codes, never created in Shopify

function run(label, fn) {
  try { fn(); console.log(`[PASS] ${label}`); }
  catch (e) { console.error(`[FAIL] ${label}: ${e.message}`); process.exitCode = 1; }
}

// --- baseline ---------------------------------------------------------
let db = openDb();
const before = db.prepare(`SELECT COUNT(*) c FROM event_leads WHERE event_id = ?`).get(EVENT).c;
const beforeTotal = db.prepare(`SELECT COUNT(*) c FROM event_leads`).get().c;
const beforePurchasesTotal = db.prepare(`SELECT COUNT(*) c FROM purchases`).get().c;
console.log(`baseline: event_leads(event=${EVENT})=${before} event_leads(total)=${beforeTotal} purchases(total)=${beforePurchasesTotal}`);
db.close();

// --- step 1: insert a lead via the REAL production entrypoint ---------
run("insert lead via event-lead-intake.mjs add (production code path)", () => {
  const out = execFileSync("node", [
    "event-lead-intake.mjs", "add",
    "--event", EVENT, "--method", "paper",
    "--paper-slip", "TEST-VERIFY",
    "--redeem-code", TEST_CODE,
    "--captured-at", "2026-08-23T05:00:00Z",
    "--entered-by", "verification-script",
  ], { cwd: CDP_DIR, encoding: "utf-8" });
  console.log("  ", out.trim());
});

db = openDb();
const lead = db.prepare(`SELECT * FROM event_leads WHERE redeem_code = ?`).get(TEST_CODE);
run("lead row exists with redeem_code_used=0", () => {
  if (!lead) throw new Error("lead not found");
  if (lead.redeem_code_used !== 0) throw new Error(`expected 0, got ${lead.redeem_code_used}`);
});

// --- step 2: replay the EXACT matching SQL shopify-sync.mjs uses ------
// (verbatim copies of the prepared statements in shopify-sync.mjs, run
// against a synthetic order row — NO real Shopify order is created (no
// Shopify API call is made at all in this script); this tests the
// CDP-side matching logic in isolation, which is all that is under this
// repo's control and independent of whether the code is live in Shopify.
//
// redeemed_order_id has a FOREIGN KEY REFERENCES purchases(order_id), so
// (as in real production, where redemption always runs right after the
// order's own upsertPurchase() in the same loop iteration) a purchases
// row must exist first. We insert one locally in the CDP SQLite store
// ONLY (never touching Shopify), explicitly flagged is_test=1 — the exact
// column this schema provides for this purpose — and delete it in cleanup.
const FAKE_ORDER_ID = "shopify:verification-test-no-real-order";
run("insert synthetic is_test=1 purchases row (local SQLite only, no Shopify call)", () => {
  db.prepare(
    `INSERT INTO purchases (order_id, source_channel, source_order_ref, person_key, ordered_at,
                            amount, currency, is_subscription, subscription_count, subscription_signal,
                            order_status, is_cancelled, is_test, raw_source_name, discount_codes,
                            created_at, updated_at)
     VALUES (?, 'shopify', '#TEST-VERIFY', NULL, ?, 0, 'JPY', 0, NULL, NULL, 'PAID', 0, 1, 'verification-script',
             ?, ?, ?)`
  ).run(FAKE_ORDER_ID, nowIso(), JSON.stringify([TEST_CODE]), nowIso(), nowIso());
});

const findPendingLeadByCode = db.prepare(
  `SELECT lead_id FROM event_leads WHERE redeem_code = ? AND redeem_code_used = 0`
);
const redeemLead = db.prepare(
  `UPDATE event_leads
      SET redeem_code_used  = 1,
          redeemed_order_id = ?,
          redeemed_at       = ?,
          person_key        = COALESCE(person_key, ?),
          updated_at        = ?
    WHERE lead_id = ?`
);

run("simulated order carrying the code redeems the pending lead", () => {
  const pending = findPendingLeadByCode.get(TEST_CODE);
  if (!pending) throw new Error("expected a pending lead for this code, found none");
  const r = redeemLead.run(FAKE_ORDER_ID, nowIso(), null, nowIso(), pending.lead_id);
  if (r.changes !== 1) throw new Error(`expected 1 row updated, got ${r.changes}`);
});

run("re-running the match finds nothing pending (already consumed)", () => {
  const pending2 = findPendingLeadByCode.get(TEST_CODE);
  if (pending2) throw new Error("code should no longer be pending after redemption");
});

const after = db.prepare(`SELECT * FROM event_leads WHERE redeem_code = ?`).get(TEST_CODE);
run("redeemed row has redeem_code_used=1 and correct redeemed_order_id", () => {
  if (after.redeem_code_used !== 1) throw new Error(`redeem_code_used=${after.redeem_code_used}`);
  if (after.redeemed_order_id !== FAKE_ORDER_ID) throw new Error(`redeemed_order_id=${after.redeemed_order_id}`);
});

// --- step 3: cleanup — fully delete both synthetic rows ----------------
run("cleanup: delete synthetic test lead row", () => {
  const r = db.prepare(`DELETE FROM event_leads WHERE redeem_code = ?`).run(TEST_CODE);
  if (r.changes !== 1) throw new Error(`expected to delete 1 row, deleted ${r.changes}`);
});
run("cleanup: delete synthetic is_test=1 purchases row", () => {
  const r = db.prepare(`DELETE FROM purchases WHERE order_id = ? AND is_test = 1`).run(FAKE_ORDER_ID);
  if (r.changes !== 1) throw new Error(`expected to delete 1 row, deleted ${r.changes}`);
});

const finalCount = db.prepare(`SELECT COUNT(*) c FROM event_leads WHERE event_id = ?`).get(EVENT).c;
const finalTotal = db.prepare(`SELECT COUNT(*) c FROM event_leads`).get().c;
const finalPurchasesTotal = db.prepare(`SELECT COUNT(*) c FROM purchases`).get().c;
run("event_leads AND purchases both back to pre-test baseline (no residue)", () => {
  if (finalCount !== before) throw new Error(`event-scoped count ${finalCount} != baseline ${before}`);
  if (finalTotal !== beforeTotal) throw new Error(`total count ${finalTotal} != baseline ${beforeTotal}`);
  if (finalPurchasesTotal !== beforePurchasesTotal) throw new Error(`purchases total changed: ${beforePurchasesTotal} -> ${finalPurchasesTotal}`);
});

// confirm no purchases row lingers for the fake order id after cleanup
const fakePurchase = db.prepare(`SELECT * FROM purchases WHERE order_id = ?`).get(FAKE_ORDER_ID);
run("no residual purchases row for the synthetic order id after cleanup", () => {
  if (fakePurchase) throw new Error("a purchases row still exists — cleanup failed");
});

db.close();
console.log(`\nfinal: event_leads(event=${EVENT})=${finalCount} event_leads(total)=${finalTotal}`);
