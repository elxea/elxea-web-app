/**
 * Customer Account OAuth エンドポイントの env 化（R-13）テスト。
 *
 * 守りたい性質:
 *   - env 未設定 → 現行の本番ドメイン account.elxea.com にフォールバック（Production 挙動不変＝本番非回帰）
 *   - SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN 設定 → 開発ストアに向く（テスト環境で偽陰性 FAIL しない）
 *   - 完全 URL の明示指定が domain より優先される（管理画面表示値をそのまま貼るエスケープハッチ）
 *
 * パス形式の根拠（shopify.dev の OpenID discovery が返す形）:
 *   https://<shop-domain>/authentication/oauth/authorize
 *   https://<shop-domain>/authentication/oauth/token
 *   https://<shop-domain>/authentication/logout
 */
import { describe, it, expect, afterEach, vi } from "vitest";

// customer.ts は SESSION_SECRET 未設定だと import 時点で throw する（トークン暗号化の fail-fast）。
// vi.hoisted は import より前に実行されるため、ここでダミー値を入れてから読み込む。
// 本テストは URL 組み立てのみを見るので暗号鍵の中身は結果に影響しない。
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "0".repeat(64);
});

import {
  getAccountDomain,
  getAuthorizeUrl,
  getTokenUrl,
  getLogoutUrl,
  buildAuthorizeUrl,
  buildLogoutUrl,
} from "@/lib/shopify/customer";

const PROD_DOMAIN = "account.elxea.com";
const DEV_STORE_DOMAIN = "elxea-test.myshopify.com";

const ENV_KEYS = [
  "SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN",
  "SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL",
  "SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL",
  "SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL",
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearEnv();
});

describe("Customer Account OAuth endpoints — env 未設定時のフォールバック（本番非回帰）", () => {
  it("env 未設定 → 現行の本番ドメインを使う", () => {
    clearEnv();
    expect(getAccountDomain()).toBe(PROD_DOMAIN);
    expect(getAuthorizeUrl()).toBe(`https://${PROD_DOMAIN}/authentication/oauth/authorize`);
    expect(getTokenUrl()).toBe(`https://${PROD_DOMAIN}/authentication/oauth/token`);
    expect(getLogoutUrl()).toBe(`https://${PROD_DOMAIN}/authentication/logout`);
  });

  it("空文字・空白のみは「未設定」とみなしフォールバックする（誤って空を入れても本番ドメインに倒れる）", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN = "   ";
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL = "";
    expect(getAccountDomain()).toBe(PROD_DOMAIN);
    expect(getAuthorizeUrl()).toBe(`https://${PROD_DOMAIN}/authentication/oauth/authorize`);
  });

  it("buildAuthorizeUrl / buildLogoutUrl も env 未設定なら本番ドメイン宛のまま", () => {
    clearEnv();
    const authorize = buildAuthorizeUrl({
      redirectUri: "https://example.test/api/auth/callback",
      state: "s",
      nonce: "n",
      codeChallenge: "c",
    });
    expect(authorize.startsWith(`https://${PROD_DOMAIN}/authentication/oauth/authorize?`)).toBe(true);

    const logout = buildLogoutUrl({ postLogoutRedirectUri: "https://example.test/" });
    expect(logout.startsWith(`https://${PROD_DOMAIN}/authentication/logout?`)).toBe(true);
  });
});

describe("Customer Account OAuth endpoints — env 設定時（開発ストアに向ける）", () => {
  it("SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN で 3 エンドポイントすべてが開発ストアに向く", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN = DEV_STORE_DOMAIN;
    expect(getAccountDomain()).toBe(DEV_STORE_DOMAIN);
    expect(getAuthorizeUrl()).toBe(`https://${DEV_STORE_DOMAIN}/authentication/oauth/authorize`);
    expect(getTokenUrl()).toBe(`https://${DEV_STORE_DOMAIN}/authentication/oauth/token`);
    expect(getLogoutUrl()).toBe(`https://${DEV_STORE_DOMAIN}/authentication/logout`);
  });

  it("開発ストアに向けた状態で本番ドメインが一切現れない（本番非接触の担保）", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN = DEV_STORE_DOMAIN;
    const urls = [
      getAuthorizeUrl(),
      getTokenUrl(),
      getLogoutUrl(),
      buildAuthorizeUrl({
        redirectUri: "https://preview.test/api/auth/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
      }),
      buildLogoutUrl({ postLogoutRedirectUri: "https://preview.test/" }),
    ];
    for (const u of urls) {
      expect(u).not.toContain(PROD_DOMAIN);
      expect(u).toContain(DEV_STORE_DOMAIN);
    }
  });

  it("scheme 付き / 末尾スラッシュ付きで渡しても正規化される（貼り付け事故に耐える）", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN = `https://${DEV_STORE_DOMAIN}/`;
    expect(getAccountDomain()).toBe(DEV_STORE_DOMAIN);
    expect(getAuthorizeUrl()).toBe(`https://${DEV_STORE_DOMAIN}/authentication/oauth/authorize`);
  });
});

describe("Customer Account OAuth endpoints — 完全 URL の明示指定が domain より優先", () => {
  it("AUTHORIZE/TOKEN/LOGOUT の明示 URL が domain を上書きする", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_DOMAIN = DEV_STORE_DOMAIN;
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL =
      "https://shopify.com/authentication/12345/oauth/authorize";
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL =
      "https://shopify.com/authentication/12345/oauth/token";
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL =
      "https://shopify.com/authentication/12345/logout";

    expect(getAuthorizeUrl()).toBe("https://shopify.com/authentication/12345/oauth/authorize");
    expect(getTokenUrl()).toBe("https://shopify.com/authentication/12345/oauth/token");
    expect(getLogoutUrl()).toBe("https://shopify.com/authentication/12345/logout");
    // domain 自体は上書きされない（他エンドポイント組み立ての基底として残る）
    expect(getAccountDomain()).toBe(DEV_STORE_DOMAIN);
  });

  it("明示 URL の末尾スラッシュは剥がれ、クエリ連結が壊れない", () => {
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL =
      "https://shopify.com/authentication/12345/oauth/authorize/";
    expect(getAuthorizeUrl()).toBe("https://shopify.com/authentication/12345/oauth/authorize");
    const url = buildAuthorizeUrl({
      redirectUri: "https://preview.test/api/auth/callback",
      state: "s",
      nonce: "n",
      codeChallenge: "c",
    });
    expect(url).toContain("/oauth/authorize?client_id=");
  });
});
