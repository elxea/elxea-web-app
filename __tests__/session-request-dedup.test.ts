/**
 * セッション解決が「1 リクエスト 1 回」に畳まれていることの配線ガード（Wave 3 / F15）。
 *
 * ## なぜソースを読むテストなのか
 *
 * `React.cache` のメモ化は **リクエスト境界を持つ実行環境でしか効かない**。
 * vitest（素の Node）で呼ぶと素通しになるので、「2 回呼んで 1 回しか走らない」を
 * 実挙動として観測することができない。効いているかどうかを見られる場所が
 * 本番の描画しか無い以上、**外れたことに気づけるのは配線の形だけ**である。
 *
 * 守っている契約:
 *   - `getSession` / `getCustomerFromSession` / `getSubscriptionsFromSession` /
 *     `resolveIdentity` は `cache(...)` を通して公開される。
 *   - `async function getSession()` のような**素の再エクスポートに戻さない**。
 *
 * ## 外れると何が起きるか（戻してはいけない理由）
 *
 * `getSession()` はマイページ 1 枚の描画で 3 か所から呼ばれる。access token が
 * 切れている描画では 3 回ともリフレッシュ分岐に入り、**同じ refresh token を 3 本が
 * 同時に使う**。Shopify はリフレッシュのたびに refresh token を回すので、先に着いた
 * 1 本以外は無効な token を掴む —「数時間後に再訪すると黙ってログアウトしている」の
 * 温床がここにある。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("リクエスト内の重複排除（React.cache）", () => {
  const cases: Array<{ file: string; symbol: string }> = [
    { file: "lib/shopify/auth.ts", symbol: "getSession" },
    { file: "lib/shopify/auth.ts", symbol: "getCustomerFromSession" },
    { file: "lib/shopify/auth.ts", symbol: "getSubscriptionsFromSession" },
    { file: "lib/firebase/auth-guard.ts", symbol: "resolveIdentity" },
  ];

  for (const { file, symbol } of cases) {
    it(`${symbol} は cache() を通して公開される（${file}）`, () => {
      const code = source(file);

      /* `export const <symbol>: <型> = cache(<実体>);`
         型注釈にアロー (`=>`) が入るので「= 以外」では区切れない。長さだけ
         上限にして、宣言 1 つ分の範囲で `= cache(` に届くことを見る。 */
      const wrapped = new RegExp(
        `export const ${symbol}\\s*:[\\s\\S]{0,160}?=\\s*\\n?\\s*cache\\(`,
      );
      expect(code).toMatch(wrapped);

      // 素の関数エクスポートに戻っていない。
      expect(code).not.toMatch(
        new RegExp(`export async function ${symbol}\\s*\\(`),
      );
    });
  }

  it("両ファイルとも react の cache を import している", () => {
    for (const file of ["lib/shopify/auth.ts", "lib/firebase/auth-guard.ts"]) {
      expect(source(file)).toMatch(/import \{ cache \} from "react";/);
    }
  });
});

describe("マイページは連携照会を描画モデルと並列に走らせる", () => {
  /**
   * 直列に戻ると、cx-agent が遅い日にその待ち時間がまるごと表示時間へ上乗せされる
   * （設計書 §4 の直列チェーン）。並列であることは「1 つの `Promise.all` で
   * 両方を待っている」という形でしか機械的に確かめられない。
   */
  it("view と linkage を 1 つの Promise.all で待つ", () => {
    const page = source("app/[locale]/account/page.tsx");

    expect(page).toMatch(
      /const \[view, lineLinkage\] = await Promise\.all\(\[viewPromise, linkagePromise\]\);/,
    );
    // 連携照会を先に await し切る形（直列）に戻っていない。
    expect(page).not.toMatch(/await fetchLineLinkageStatus\(/);
    expect(page).not.toMatch(/await fetchLineLinkageStatusForLineUser\(/);
    expect(page).not.toMatch(/await loadAccountView\(/);
  });
});
