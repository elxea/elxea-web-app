import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ITEMS,
  accountActionHref,
  lockedActionFor,
} from "@/lib/account-capabilities";

/**
 * マイページの「使えない項目」に添える導線が、実際に起こることだけを言う。
 *
 * ## 直している嘘 (再設計 J-1 案B)
 *
 * LINE だけでログインしている人のマイページには「メールアドレスで連携する」という
 * ボタンが出ていた。押すと `/api/auth/login` へ行き、Shopify のログインが走る。
 * **LINE との連携は一切起きない。** つまりこのボタンは、書いてあることに関して
 * 定義上 100% 何も起こさない。
 *
 * 正しい姿は 2 段階である:
 *   1. メールアドレスでログインする (このボタン)
 *   2. ログイン後のマイページで「LINEと連携する」を押す (`LineLinkageEntry`)
 *
 * ここは 1 のラベルが 2 を名乗らないことを縛る。連携機能そのものの新設
 * (ワンタップ = 案A) は Wave 2 で、この pin はその実装が入っても生き残る
 * (案A が入るときは行き先ごと `AccountActionTarget` に足す)。
 *
 * 設計書: deliverables/f16-asis/redesign.md §4 J-1 / §3-2 M-3
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const account = (locale: "ja" | "en") =>
  JSON.parse(read(`messages/${locale}.json`)).account as Record<string, string>;

describe("使えない項目の導線は「連携する」を名乗らない (J-1 案B)", () => {
  it("ラベルは連携ではなくログインだと言う", () => {
    const ja = account("ja");
    const en = account("en");

    /* 「連携」という動詞をこのボタンに載せない。押しても連携は起きないため。 */
    expect(ja.connectShopifyButton).not.toContain("連携");
    expect(ja.connectShopifyButton).toContain("ログイン");

    expect(en.connectShopifyButton.toLowerCase()).not.toContain("connect");
    expect(en.connectShopifyButton.toLowerCase()).toContain("sign in");
  });

  it("理由の文言はログイン後に LINE と連携できることまで案内する (2 段階)", () => {
    const ja = account("ja");
    const en = account("en");

    expect(ja.emailRequiredReason).toContain("ログイン");
    expect(ja.emailRequiredReason).toContain("LINE");

    expect(en.emailRequiredReason.toLowerCase()).toContain("sign in");
    expect(en.emailRequiredReason).toContain("LINE");
  });

  it("定期便ページの案内も「連携が必要」ではなく「ログインが必要」と言う", () => {
    expect(account("ja").subscriptionsEmailRequired).not.toContain("連携");
    expect(account("en").subscriptionsEmailRequired.toLowerCase()).not.toContain("connect");
  });

  it("画面に出る導線の文言は、どのキーも「連携する」を名乗っていない", () => {
    /* カタログに新しい項目やラベルを足したとき、ここが赤くなる。 */
    const ja = account("ja");
    for (const item of ACCOUNT_ITEMS) {
      const key = item.lockedAction?.labelKey;
      if (!key) continue;
      expect(ja[key], `account.${key}`).not.toContain("連携");
    }
  });
});

describe("行き先はカタログが持つ (as-is D-18 のハードコード解消)", () => {
  it("ラベルと行き先は必ず対で定義されている", () => {
    for (const item of ACCOUNT_ITEMS) {
      if (item.lockedAction === null) continue;
      expect(item.lockedAction.labelKey, item.id).toBeTruthy();
      expect(item.lockedAction.target, item.id).toBe("shopify-login");
    }
  });

  it("URL への変換は accountActionHref だけが行い、locale を必ずエスケープする", () => {
    expect(accountActionHref("shopify-login", "ja")).toBe("/api/auth/login?locale=ja");
    /* 変な locale を渡されてもクエリを壊さない (URL 組み立てを 1 箇所にする効能)。 */
    expect(accountActionHref("shopify-login", "ja&foo=1")).toBe(
      "/api/auth/login?locale=ja%26foo%3D1"
    );
  });

  it("マイページと定期便ページは行き先を自前で組み立てない", () => {
    for (const relative of [
      "app/[locale]/account/page.tsx",
      "app/[locale]/account/subscriptions/page.tsx",
    ]) {
      const source = read(relative);
      /* 経緯を書いたコメントでの言及は許す。禁じるのは href への直書き。 */
      expect(source, relative).not.toMatch(/href\s*[:=]\s*\{?\s*[`"']\/api\/auth\/login/);
      expect(source, relative).toContain("accountActionHref");
    }
  });

  it("定期便ページはカタログの subscriptions 項目と同じ導線を使う", () => {
    const action = lockedActionFor("subscriptions");
    expect(action).not.toBeNull();
    expect(action?.labelKey).toBe("connectShopifyButton");
    expect(read("app/[locale]/account/subscriptions/page.tsx")).toContain(
      'lockedActionFor("subscriptions")'
    );
  });
});
