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

  /**
   * ここは以前「理由の文言はログイン後に LINE と連携できることまで案内する」だった。
   * 意図 (2 段階だと分かるようにする) は正しかったが、この 1 文が **3 か所に同時に
   * 出る** ことが見落とされていた。`emailRequiredReason` は Shopify が要る 3 項目
   * (定期便・注文履歴・お支払い方法) 共通の理由文で、LINE だけでログインしている人の
   * マイページではその 3 つが同時に locked になるため、同じ連携の案内が 3 回続けて
   * 並ぶ (Setaka 実機指摘 2026-08-25「使いにくい」)。
   *
   * 2 段階であることを伝える役目は `LineLinkageEntry` が持つ (画面に 1 つだけある
   * 連携の節)。理由文は理由だけを言う。
   */
  it("理由は理由だけを言う。連携の案内を重ねない (F16 / 入口は 1 か所)", () => {
    const ja = account("ja");
    const en = account("en");

    expect(ja.emailRequiredReason).toContain("ログイン");
    expect(en.emailRequiredReason.toLowerCase()).toContain("sign in");

    /* 3 項目に同時に出る文なので、ここに連携の勧誘を載せない。 */
    expect(ja.emailRequiredReason).not.toContain("LINE");
    expect(ja.emailRequiredReason).not.toContain("連携");
    expect(en.emailRequiredReason).not.toContain("LINE");
    expect(en.emailRequiredReason.toLowerCase()).not.toContain("link");
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

  it("どちらのページも行き先を自前で組み立てない", () => {
    for (const relative of [
      "app/[locale]/account/page.tsx",
      "app/[locale]/account/subscriptions/page.tsx",
    ]) {
      const source = read(relative);
      /* 経緯を書いたコメントでの言及は許す。禁じるのは href への直書き。 */
      expect(source, relative).not.toMatch(/href\s*[:=]\s*\{?\s*[`"']\/api\/auth\/login/);
    }
  });

  it("定期便ページだけがカタログの行き先を読む (マイページは導線を持たない / F16)", () => {
    /* マイページ本体の locked カードは理由だけを言う。行動を出すと Shopify が要る
       3 項目それぞれに同じ導線が付き、1 画面に同じ入口が 3 本並ぶ。連携・ログインの
       入口はあの画面では `LineLinkageEntry` の 1 か所だけ。 */
    expect(read("app/[locale]/account/page.tsx")).not.toContain("accountActionHref(");
    expect(read("app/[locale]/account/subscriptions/page.tsx")).toContain(
      "accountActionHref("
    );
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
