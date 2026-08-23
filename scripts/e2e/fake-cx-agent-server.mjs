/**
 * 偽 cx-agent（E2E 専用）— 連携台帳のインメモリ実装。
 *
 * ## なぜ必要か
 *
 * 「この LINE はどの顧客と連携しているか」の**正本は Firestore ではなく cx-agent**
 * （Cloudflare Worker）で、web-app は HTTP で問い合わせている
 * （`lib/line/linkage-status.ts` / `lib/auth/identity-link.ts` / `lib/line/unlink.ts`）。
 * つまり合体・分離のシナリオは、この台帳が無いと 1 行も進まない。
 *
 * wrangler dev を起こす手もあるが、(1) 別リポの実装とスキーマに依存する、(2) 起動が遅く
 * CI で不安定になりやすい、(3) 本テストが確かめたいのは **web-app 側の状態遷移** であって
 * Worker の内部実装ではない、の 3 点からインメモリの偽台帳にする。契約（パス・要求・応答）は
 * 呼び出し側のコードから起こしていて、ここが唯一の定義箇所になる。
 *
 * ## 契約（呼び出し元）
 *
 *   POST /api/identity/link-line      … app/api/line-callback（LINE ログイン成立時の通知）
 *   POST /api/identity/link-liff      … app/api/user/line-link/callback（連携の成立）
 *   GET  /api/identity/linkage-status … lib/line/linkage-status.ts（順引き・逆引き）
 *   POST /api/identity/unlink         … lib/line/unlink.ts（解除）
 *
 * すべて `X-API-Key: SYNC_API_SECRET` を要求する。**鍵が無ければ 401 を返す**のは意図的で、
 * 「アプリが鍵を送っている」ことまでテストで確かめられるようにするため（送っていなくても
 * 200 を返す偽物だと、鍵を落とす退行が見えない）。
 *
 * ## モデル
 *
 * 台帳は `line_user_id -> { shopifyCustomerId, linkedAt }` の 1 本。1 顧客に複数 LINE が
 * ぶら下がる（世帯共有）ため、逆向きの一意制約は置かない。これは本番の customer_linkages と
 * 同じ形で、解除が「その LINE だけ」を外す挙動（P8）をテストで再現するのに必要。
 *
 * 使い方: node scripts/e2e/fake-cx-agent-server.mjs <port> <apiKey> [hitLogPath]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 4011);
const API_KEY = process.argv[3] ?? "fake-sync-api-secret";
const HIT_LOG = process.argv[4] ?? null;

/** line_user_id -> { shopifyCustomerId, linkedAt } */
const ledger = new Map();

if (HIT_LOG) mkdirSync(path.dirname(HIT_LOG), { recursive: true });

function recordHit(entry) {
  if (!HIT_LOG) return;
  try {
    appendFileSync(HIT_LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    /* ログ失敗でテストを落とさない。 */
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * 顧客 ID の数値部分だけで比較する。
 *
 * web-app 側は GID（`gid://shopify/Customer/123`）と数値 ID の両方を持ち回るので、
 * 台帳が文字列一致で持つと「連携したのに一致しない」という取り違えが起きる。
 * `lib/firebase/types.ts` の `extractCustomerId` と同じ正規化をここでも行う。
 */
function normalizeCustomerId(raw) {
  if (typeof raw !== "string") return null;
  const m = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(raw);
  return m ? m[1] : raw;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname } = url;

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }

  /* ---- テストからの操作 ---------------------------------------------------- */

  if (pathname === "/__control/reset" && req.method === "POST") {
    ledger.clear();
    return json(res, 200, { ok: true });
  }

  if (pathname === "/__control/ledger") {
    return json(res, 200, {
      entries: [...ledger.entries()].map(([lineUserId, v]) => ({ lineUserId, ...v })),
    });
  }

  /* ---- 認証 ---------------------------------------------------------------- */

  const isIdentityApi = pathname.startsWith("/api/identity/");
  if (isIdentityApi && req.headers["x-api-key"] !== API_KEY) {
    recordHit({ path: pathname, rejected: "missing_or_bad_api_key" });
    return json(res, 401, { error: "unauthorized" });
  }

  /* ---- 連携 ---------------------------------------------------------------- */

  if (pathname === "/api/identity/link-line" && req.method === "POST") {
    const body = await readJson(req);
    recordHit({ path: pathname, lineUserId: body.line_user_id ?? null });
    /* LINE ログインの通知。**連携を成立させるものではない**（連携は link-liff / LIFF 経由
     * でしか成立しない）。ここで台帳に書いてしまうと「LINE でログインしただけで
     * メールアカウントと合体した」という、本番では起きない状態を作ってしまう。 */
    return json(res, 200, { ok: true });
  }

  if (pathname === "/api/identity/link-liff" && req.method === "POST") {
    const body = await readJson(req);
    const lineUserId = body.line_messaging_user_id;
    const customerId = normalizeCustomerId(body.shopify_customer_id);
    recordHit({ path: pathname, lineUserId: lineUserId ?? null, customerId });

    if (!lineUserId || !customerId) {
      return json(res, 400, { error: "invalid_request" });
    }

    const existing = ledger.get(lineUserId);
    if (existing && existing.shopifyCustomerId !== customerId) {
      /* その LINE は既に別の顧客のもの。上書きすると乗っ取りになるので拒否する
       * （web-app 側にも `linked-elsewhere` のガードがあるが、正本側でも閉じる）。 */
      return json(res, 409, { error: "already_linked_to_another_customer" });
    }

    if (!existing) {
      ledger.set(lineUserId, {
        shopifyCustomerId: customerId,
        linkedAt: new Date().toISOString(),
      });
    }
    return json(res, 200, { ok: true, linked: true });
  }

  /* ---- 状態照会 ------------------------------------------------------------ */

  if (pathname === "/api/identity/linkage-status" && req.method === "GET") {
    const lineUserId = url.searchParams.get("line_user_id");
    const customerParam = url.searchParams.get("shopify_customer_id");

    if (lineUserId) {
      const entry = ledger.get(lineUserId);
      recordHit({ path: pathname, direction: "reverse", linked: Boolean(entry) });
      if (!entry) return json(res, 200, { linked: false, linkedAt: null });
      return json(res, 200, {
        linked: true,
        linkedAt: entry.linkedAt,
        shopify_customer_id: entry.shopifyCustomerId,
      });
    }

    const customerId = normalizeCustomerId(customerParam);
    if (!customerId) return json(res, 400, { error: "invalid_request" });

    const hit = [...ledger.values()].find((v) => v.shopifyCustomerId === customerId);
    recordHit({ path: pathname, direction: "forward", linked: Boolean(hit) });
    return json(res, 200, {
      linked: Boolean(hit),
      linkedAt: hit ? hit.linkedAt : null,
    });
  }

  /* ---- 解除 ---------------------------------------------------------------- */

  if (pathname === "/api/identity/unlink" && req.method === "POST") {
    const body = await readJson(req);
    const customerId = normalizeCustomerId(body.shopify_customer_id);
    const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id : null;

    let cleared = 0;
    for (const [key, value] of [...ledger.entries()]) {
      if (value.shopifyCustomerId !== customerId) continue;
      /* line_user_id が来ているときは**その 1 本だけ**外す。世帯共有で家族の連携を
       * 巻き添えにしないため（web-app 側 P8 の想定と揃える）。 */
      if (lineUserId && key !== lineUserId) continue;
      ledger.delete(key);
      cleared += 1;
    }
    recordHit({ path: pathname, customerId, lineUserId, cleared });
    return json(res, 200, { cleared_count: cleared });
  }

  /* チャット等、識別以外の呼び出しは素通しで 200。テスト対象ではないので、ここで
   * 500 を返すとページの描画が壊れて本題の assertion が読めなくなる。 */
  recordHit({ path: pathname, unhandled: true });
  return json(res, 200, {});
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`fake cx-agent on 127.0.0.1:${PORT}\n`);
});
