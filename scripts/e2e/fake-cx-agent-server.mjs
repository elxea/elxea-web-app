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
 *   POST /api/erase                   … lib/erase/cx-agent.ts（GDPR 消去・M-5）
 *
 * `/api/identity/*` は `X-API-Key: SYNC_API_SECRET` を要求する。**鍵が無ければ 401 を返す**
 * のは意図的で、「アプリが鍵を送っている」ことまでテストで確かめられるようにするため
 * （送っていなくても 200 を返す偽物だと、鍵を落とす退行が見えない）。
 *
 * `/api/erase` は **別鍵**（`Authorization: Bearer ERASE_API_SECRET`）を要求する。本物が
 * 鍵を分けているのは「消去だけを許す鍵」を切り出すためで、偽物が同じ鍵を受けてしまうと
 * 取り違えの退行が見えない。
 *
 * ## LINE トーク内の Account Link は web-app を通らない（S13）
 *
 * この経路の連携は LINE → cx-agent の webhook だけで完結し、web-app のブラウザ導線を
 * 一度も通らない。だから偽物側にも「cx-agent が単独で台帳に書き、web-app へ合体を
 * 知らせる」動きが要る（`/__control/account-link`）。本物と同じく
 * `POST {WEB_APP_BASE_URL}/api/internal/linkage-established` を Bearer で叩く。
 *
 * ## モデル
 *
 * 台帳は `line_user_id -> { shopifyCustomerId, linkedAt }` の 1 本。1 顧客に複数 LINE が
 * ぶら下がる（世帯共有）ため、逆向きの一意制約は置かない。これは本番の customer_linkages と
 * 同じ形で、解除が「その LINE だけ」を外す挙動（P8）をテストで再現するのに必要。
 *
 * ## テストからの操作口 (`/__control/*`)
 *
 *   POST /__control/reset            … 台帳と遅延を初期化
 *   GET  /__control/ledger           … 台帳の中身
 *   POST /__control/latency {ms,times} … `/api/identity/*` の応答を遅らせる
 *   GET  /__control/latency          … 現在の遅延設定
 *   POST /__control/account-link     … LINE トーク内の Account Link を再現（S13）
 *   POST /__control/erase-mode       … `/api/erase` の応答を仕込む（S15）
 *   GET  /__control/erased           … 消去された subject の一覧
 *
 * 使い方:
 *   node scripts/e2e/fake-cx-agent-server.mjs \
 *     <port> <apiKey> [hitLogPath] [webAppBaseUrl] [linkageEventSecret] [eraseSecret]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 4011);
const API_KEY = process.argv[3] ?? "fake-sync-api-secret";
const HIT_LOG = process.argv[4] ?? null;
/** 合体イベントの送り先（web-app）。S13 でだけ使う。 */
const WEB_APP_BASE_URL = process.argv[5] ?? null;
/** 合体イベントの鍵。**SYNC_API_SECRET とは別鍵**（本物と同じ扱い）。 */
const LINKAGE_EVENT_SECRET = process.argv[6] ?? null;
/** 消去 API の鍵。これも別鍵。 */
const ERASE_API_SECRET = process.argv[7] ?? "fake-erase-api-secret";

/** line_user_id -> { shopifyCustomerId, linkedAt } */
const ledger = new Map();

/**
 * 消された subject（`{kind, id}` の文字列キー）。S15 で「本当に消えたか」を見る。
 *
 * 本物の `/api/erase` は Supabase の台帳・会話履歴・カルテを消し、消し残しを
 * 検算して 3 分岐で返す。偽物はその**外形**（誰について呼ばれたか / 3 分岐のどれを
 * 返したか）だけを持つ。中身の正しさは cx-agent 側の担当。
 */
const erased = new Set();

/**
 * `/api/erase` の応答の仕込み。
 *
 * - `"ok"`        … 1 回で 200 {status:"erased"}
 * - `"continue"`  … 最初の N 回は 202 {continue_required:true}、そのあと 200
 * - `"residue"`   … 500（消し残し）
 *
 * **202 を成功として扱う実装を落とすため**に `continue` が要る。202 は 2xx だが
 * 完了ではない（Workers の subrequest 上限に当たって途中まで消しただけ）。
 * 素朴に `res.ok` で判定すると、ここが静かに「成功」になって消し残しが残る。
 */
let eraseMode = "ok";
let eraseContinueRemaining = 0;

/**
 * 注入する遅延（ミリ秒）。既定 0 = 即答。
 *
 * ## なぜ要るのか（as-is D-16）
 *
 * web-app は cx-agent への問い合わせに 3000ms の上限を置き、超えたら
 * `linked: null`（不明）へ縮退する（`lib/line/linkage-status.ts`）。この
 * **縮退の先にある画面**が、今回の症状で一番効く安全装置になっている
 * （「未連携」と言い切らず「確認できませんでした」を出す）。
 *
 * ところが偽サーバーは即答しかできず、`delay` / `sleep` / `setTimeout` /
 * `latency` / `timeout` の出現がゼロだった。つまり **3000ms の上限も、
 * その先の縮退も、テストで一度も踏まれていなかった**。「タイムアウト時の
 * 挙動」は設計文書とコメントの中にしか存在しない状態。
 *
 * ここで注入できるようにして、E2E から実際に踏ませる。
 *
 * ⚠ 遅らせるのは `/api/identity/*` だけ。`/__control/*` と `/health` は
 *   常に即答する（遅延を解除する手段まで一緒に固まると、テストが自分で
 *   自分を詰ませる）。
 */
let latencyMs = 0;

/** 遅延の残り回数。`null` なら無期限（reset まで続く）。 */
let latencyRemaining = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 遅延を 1 回分消費する。適用したミリ秒を返す（0 なら遅らせていない）。
 *
 * ⚠ 記録は **待つ前** に取る。web-app は 3000ms で諦めて先へ進むので、待ち
 *   終わってから記録すると、テストが「遅延が効いたか」を確かめる時点でまだ
 *   1 行も書かれていない（実際にそれで落ちた）。知りたいのは「遅らせることに
 *   した」という事実なので、決めた瞬間に残す。
 */
async function applyLatency(pathname) {
  if (latencyMs <= 0) return 0;
  if (latencyRemaining !== null) {
    if (latencyRemaining <= 0) return 0;
    latencyRemaining -= 1;
  }
  const ms = latencyMs;
  recordHit({ path: pathname, delayedMs: ms });
  await sleep(ms);
  return ms;
}

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
    /* 遅延も一緒に落とす。落とし忘れた遅延が次の spec に漏れると、無関係な
       テストが「たまに落ちる」形で壊れ、原因の特定に一番時間がかかる。 */
    latencyMs = 0;
    latencyRemaining = null;
    erased.clear();
    eraseMode = "ok";
    eraseContinueRemaining = 0;
    return json(res, 200, { ok: true });
  }

  /* ---- LINE トーク内の Account Link を再現する（S13）--------------------- *
   *
   * この経路の連携は LINE → cx-agent の webhook だけで完結し、**web-app のブラウザ
   * 導線を一度も通らない**。それが D-3 の正体で、web-app 側に合体のきっかけが
   * 構造的に存在しなかった。M-2 で「台帳に行が立った」を書いた側から知らせる形に
   * したので、偽物もそのとおりに振る舞う。
   *
   * 台帳に書く → web-app の内部口を Bearer で叩く、の 2 手。本物
   * （src/lib/linkage-notify.ts）と同じ URL・同じヘッダ・同じ body にしてある。 */
  if (pathname === "/__control/account-link" && req.method === "POST") {
    const body = await readJson(req);
    const lineUserId = body.line_user_id;
    const customerId = normalizeCustomerId(body.shopify_customer_id);
    if (!lineUserId || !customerId) return json(res, 400, { error: "invalid_request" });

    ledger.set(lineUserId, {
      shopifyCustomerId: customerId,
      linkedAt: new Date().toISOString(),
    });
    recordHit({ path: pathname, lineUserId, customerId });

    if (!WEB_APP_BASE_URL || !LINKAGE_EVENT_SECRET) {
      /* 本物も未設定なら通知しない（連携は成立させたまま）。テストからは
         「通知していない」ことが見えるように、成立と通知を別に返す。 */
      return json(res, 200, { linked: true, notified: false, reason: "not-configured" });
    }

    let notifyStatus = null;
    let notifyError = null;
    try {
      const upstream = await fetch(
        `${WEB_APP_BASE_URL}/api/internal/linkage-established`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LINKAGE_EVENT_SECRET}`,
          },
          body: JSON.stringify({
            line_user_id: lineUserId,
            shopify_customer_id: customerId,
            source: "account_link",
          }),
        },
      );
      notifyStatus = upstream.status;
    } catch (err) {
      notifyError = err instanceof Error ? err.message : String(err);
    }

    return json(res, 200, {
      linked: true,
      notified: notifyStatus !== null && notifyStatus < 400,
      notifyStatus,
      notifyError,
    });
  }

  /* `/api/erase` の応答を仕込む（S15）。 */
  if (pathname === "/__control/erase-mode" && req.method === "POST") {
    const body = await readJson(req);
    eraseMode = ["ok", "continue", "residue"].includes(body.mode) ? body.mode : "ok";
    const times = Number(body.times);
    eraseContinueRemaining = Number.isFinite(times) && times > 0 ? times : 1;
    return json(res, 200, { ok: true, mode: eraseMode, times: eraseContinueRemaining });
  }

  if (pathname === "/__control/erased") {
    return json(res, 200, { subjects: [...erased] });
  }

  if (pathname === "/__control/ledger") {
    return json(res, 200, {
      entries: [...ledger.entries()].map(([lineUserId, v]) => ({ lineUserId, ...v })),
    });
  }

  /* 遅延の注入 (D-16)。`{ ms }` で秒単位の停止、`{ ms, times }` で回数を限る。
     `{ ms: 0 }` で解除。GET で現在値を読める。 */
  if (pathname === "/__control/latency") {
    if (req.method === "POST") {
      const body = await readJson(req);
      const ms = Number(body.ms);
      latencyMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
      const times = Number(body.times);
      latencyRemaining = Number.isFinite(times) && times > 0 ? times : null;
      return json(res, 200, { ok: true, ms: latencyMs, times: latencyRemaining });
    }
    return json(res, 200, { ms: latencyMs, times: latencyRemaining });
  }

  /* ---- 認証 ---------------------------------------------------------------- */

  const isIdentityApi = pathname.startsWith("/api/identity/");
  if (isIdentityApi && req.headers["x-api-key"] !== API_KEY) {
    recordHit({ path: pathname, rejected: "missing_or_bad_api_key" });
    return json(res, 401, { error: "unauthorized" });
  }

  /* 遅延は認証のあと・処理の前に置く。認証の前に置くと、鍵の付け忘れという
     別の欠陥まで遅延で隠れてしまう。台帳の状態は変えないので、遅らせても
     この先の分岐は同じ答えを返す（web-app 側が待てなくなるだけ）。 */
  if (isIdentityApi) await applyLatency(pathname);

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

  /* ---- 消去（M-5 / Issue A）----------------------------------------------- *
   *
   * **別鍵**（`Authorization: Bearer ERASE_API_SECRET`）を要求する。本物が
   * `SYNC_API_SECRET` と分けているのは「消去だけを許す鍵」を切り出すためで、
   * 偽物が同じ鍵を受けると取り違えの退行が見えなくなる。
   *
   * 3 分岐（#42 以降）をそのまま返せるようにしてある。とくに **202 は 2xx だが
   * 完了ではない** — Workers の subrequest 上限に当たって途中まで消しただけで、
   * 呼び出し側は `continue_required` が false になるまで呼び直す責任を負う。 */
  if (pathname === "/api/erase" && req.method === "POST") {
    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${ERASE_API_SECRET}`) {
      recordHit({ path: pathname, rejected: "missing_or_bad_erase_secret" });
      return json(res, 401, { error: "unauthorized" });
    }

    const body = await readJson(req);
    const kind = body.subject_kind;
    const id = kind === "shopify" ? normalizeCustomerId(body.subject_id) : body.subject_id;
    if (!kind || !id) return json(res, 400, { error: "invalid_request" });

    recordHit({ path: pathname, subjectKind: kind, mode: eraseMode });

    if (eraseMode === "residue") {
      /* 消し残しあり。G10（成功偽装をしない）— 呼び出し側は 200 を返してはいけない。 */
      return json(res, 500, { status: "residue", residue: 1 });
    }

    if (eraseMode === "continue" && eraseContinueRemaining > 0) {
      eraseContinueRemaining -= 1;
      /* 途中まで消した。**ここで台帳から消してよい**（各段階は冪等で、続きは次の
         呼び出しが進める）。テストが見たいのは「呼び直したか」なので、消える範囲は
         最後まで呼び切ったときと同じにしておく。 */
      return json(res, 202, { status: "in_progress", continue_required: true });
    }

    /* 消し終わり。台帳からも落とす（本物は Supabase の行を消す）。 */
    if (kind === "shopify") {
      for (const [key, value] of [...ledger.entries()]) {
        if (value.shopifyCustomerId === id) ledger.delete(key);
      }
    } else if (kind === "line") {
      ledger.delete(id);
    }
    erased.add(`${kind}:${id}`);
    return json(res, 200, { status: "erased" });
  }

  /* チャット等、識別以外の呼び出しは素通しで 200。テスト対象ではないので、ここで
   * 500 を返すとページの描画が壊れて本題の assertion が読めなくなる。 */
  recordHit({ path: pathname, unhandled: true });
  return json(res, 200, {});
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`fake cx-agent on 127.0.0.1:${PORT}\n`);
});
