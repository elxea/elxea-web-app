/**
 * 構造不変条件: Admin API に届く Server Action は必ず所有者照合を通る。
 *
 * なぜ振る舞いテストと別に必要か: subscription-actions-authz.test.ts は
 * **今ある 2 つの action** の振る舞いを固定するが、「将来 3 つ目の Admin API 経路が
 * 追加されたとき照合を忘れる」ことは検出できない。実際に 2026-08-12 の調査で
 * 報告された IDOR はまさにこの形 (Admin API を叩く action に所有者照合が無い) で、
 * 修正 (e29fc66) 後も再発を防ぐ仕組みは無かった。
 *
 * Admin API トークンは **ストア全体に効く**。Shopify は呼び出し元顧客にスコープしない
 * ので、ログイン確認だけでは他人の契約を操作できてしまう。一方 Customer Account API
 * (pause / activate / cancel / skip) は顧客トークンで Shopify 側がスコープするため
 * 追加照合は不要 — この非対称性が本ファイルの判定軸。
 *
 * 判定はソースの静的検査で行う (実行時 mock では「まだ書かれていない action」を
 * 捕まえられないため)。Admin API 関数名は import 文から導出するので、
 * subscription-admin から新しい関数を import した時点で自動的に検査対象に入る。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.join(process.cwd(), "lib/shopify/subscription-actions.ts");
const RAW_SOURCE = readFileSync(SOURCE_PATH, "utf8");

/** 所有者照合を行う唯一の入口 (単一正本。action ごとの自前実装は禁止)。 */
const AUTHORIZE_HELPER = "authorizeContractAccess";

/** 照合の実体 — 共有 verifier。helper がこれを呼ぶことまで確認する。 */
const OWNERSHIP_VERIFIER = "verifySubscriptionContractOwnership";

/**
 * コメントと文字列リテラルを空白に潰す。
 *
 * 波括弧の対応数えで関数本体を切り出すため、コメント・文字列の中の括弧や
 * `export` の字面が混ざらないようにしておく (日本語コメントに `{}` が入っても壊れない)。
 */
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, " ");

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === "//") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      out += blank(source.slice(i, end));
      i = end;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      // 引用符自体は残す (字句の境界を保つ)。中身だけ潰す。
      out += ch + blank(source.slice(i + 1, Math.max(i + 1, j - 1))) + (source[j - 1] ?? "");
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

const SOURCE = stripCommentsAndStrings(RAW_SOURCE);

/** `./subscription-admin` から import している名前 = Admin API に届く関数。 */
function adminApiFunctionNames(source: string): string[] {
  const match = source.match(
    /import\s*\{([^}]*)\}\s*from\s*["']\.\/subscription-admin["']/
  );
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    // `foo as bar` はローカル名 (bar) で参照されるので後ろを取る
    .map((entry) => entry.split(/\s+as\s+/).pop()!.trim())
    .filter(Boolean);
}

type FnBody = { name: string; body: string };

/**
 * 関数宣言を名前と本体に切り出す。
 * `exportedOnly` で `export async function` に限定できる。
 */
function functionBodies(source: string, exportedOnly: boolean): FnBody[] {
  const pattern = exportedOnly
    ? /export\s+async\s+function\s+(\w+)/g
    : /(?:^|\n)\s*(?:export\s+)?async\s+function\s+(\w+)/g;

  const found: FnBody[] = [];
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const open = source.indexOf("{", match.index! + match[0].length);
    if (open === -1) continue;

    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    found.push({ name, body: source.slice(open, end + 1) });
  }
  return found;
}

// import 文は生ソースから読む (SOURCE は文字列リテラルを潰しているのでモジュール
// パスが消えており、ここでは使えない)。
const ADMIN_API_FUNCTIONS = adminApiFunctionNames(RAW_SOURCE);
const EXPORTED_ACTIONS = functionBodies(SOURCE, true);

/** その action 本体が実際に呼んでいる Admin API 関数。 */
function adminApiCallsIn(body: string): string[] {
  return ADMIN_API_FUNCTIONS.filter((fn) =>
    new RegExp(`\\b${fn}\\s*\\(`).test(body)
  );
}

describe("Admin API を叩く Server Action は所有者照合を必ず通る (構造不変条件)", () => {
  it("解析が成立している (import と export を実際に拾えている)", () => {
    // 解析が空振りしていると以下の検査が全部 vacuously true になるので先に固定する
    expect(ADMIN_API_FUNCTIONS.length).toBeGreaterThan(0);
    expect(EXPORTED_ACTIONS.length).toBeGreaterThan(0);
    expect(EXPORTED_ACTIONS.map((a) => a.name)).toContain(
      "changeDeliveryFrequencyAction"
    );
  });

  it("Admin API 経路の action が少なくとも 1 つある (検査が空回りしていない)", () => {
    const adminBacked = EXPORTED_ACTIONS.filter(
      (action) => adminApiCallsIn(action.body).length > 0
    );
    expect(adminBacked.map((a) => a.name).sort()).toEqual([
      "changeDeliveryFrequencyAction",
      "changeSubscriptionProductAction",
    ]);
  });

  it.each(
    EXPORTED_ACTIONS.filter((action) => adminApiCallsIn(action.body).length > 0).map(
      (action) => [action.name, action] as const
    )
  )(`%s は Admin API を呼ぶ前に ${AUTHORIZE_HELPER} を通す`, (_name, action) => {
    expect(action.body).toContain(`${AUTHORIZE_HELPER}(`);

    // 照合が Admin API 呼び出しより前に書かれていること (後から照合しても手遅れ)
    const authorizeAt = action.body.indexOf(`${AUTHORIZE_HELPER}(`);
    for (const fn of adminApiCallsIn(action.body)) {
      const adminAt = action.body.search(new RegExp(`\\b${fn}\\s*\\(`));
      expect(authorizeAt).toBeLessThan(adminAt);
    }
  });

  it("照合 helper は共有 verifier を使い、自前実装しない", () => {
    const helper = functionBodies(SOURCE, false).find(
      (fn) => fn.name === AUTHORIZE_HELPER
    );
    expect(helper, `${AUTHORIZE_HELPER} が見つからない`).toBeDefined();
    expect(helper!.body).toContain(`${OWNERSHIP_VERIFIER}(`);
    // fail-closed: 照合が真でなければ throw して呼び出し元に進ませない
    expect(helper!.body).toMatch(/throw\s+new\s+Error/);
  });

  it("照合 helper は Server Action として露出していない", () => {
    // "use server" ファイルの export はすべて公開 HTTP エンドポイントになる。
    // helper が export されると、照合そのものを外から呼べる面が増える。
    expect(SOURCE).not.toMatch(
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${AUTHORIZE_HELPER}\\b`)
    );
  });
});
