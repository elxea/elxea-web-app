/**
 * 発送リードタイムと定期便の契約条件が、サイト内で 1 通りに保たれているかの回帰テスト。
 *
 * ## なぜ必要か
 *
 * 2026-08-11 時点で、同じ「ご注文から何日で発送するか」がサイト内に **4 通り**あった。
 *
 * | 出どころ | 記載 |
 * |---|---|
 * | 特商法ページ 引渡し時期 | ご注文から3営業日以内 |
 * | 配送ページ お届けの目安 / 発送のタイミング | ご注文から2〜4日 |
 * | よくあるご質問 / 商品ページ | 2〜4日・2〜4営業日 |
 * | 旧定期便LP / 送料案内 | 通常3〜5営業日以内 |
 *
 * 特商法ページの記載は法11条3号の表示事項で、他ページの記載と食い違うこと自体が
 * 誇大広告等の禁止 (法12条) の観点で問題になる。文字列が各 messages / 各ページに
 * ばらまかれている構造なので、直しても再発する。そこで「確定値以外の言い方が
 * 混ざったら落ちる」テストにして機械的に固定する。
 *
 * 確定値: **ご注文から5営業日以内に発送** (Setaka 確定 2026-08-11)。
 *
 * 併せて、特商法ページに定期便 (継続課金) の契約条件が載っている状態も固定する
 * (法務起草の受け入れ条件 AC-2: 「定期便」「解約」「契約期間」の語が 1 回以上出現)。
 * 正本: https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { placeholderValue } from "@/lib/placeholders";

const ROOT = join(__dirname, "..");

const read = (relative: string) => readFileSync(join(ROOT, relative), "utf-8");

/** 発送リードタイムを書いてよい唯一の言い方 (日本語 / 英語)。 */
const CONFIRMED_JA = "5営業日以内";
const CONFIRMED_EN = "5 business days";

/**
 * 差し戻された古い言い方。ここに残っていたら「統一が崩れた」ということ。
 *
 * 返信のリードタイム (「2営業日以内にご返信」等) は発送とは別の事実なので入れない。
 */
const BANNED_VARIANTS = [
  "3営業日以内に発送",
  "3〜5営業日",
  "2〜4営業日",
  "2〜4日",
  "2-4 days",
  "3-5 business days",
] as const;

/** ユーザーに出る文字列を持つファイル。 */
const COPY_SOURCES = [
  "messages/ja.json",
  "messages/en.json",
  "app/[locale]/legal/tokushoho/page.tsx",
  "app/[locale]/shipping/page.tsx",
] as const;

describe("発送リードタイムの一意性", () => {
  it.each(COPY_SOURCES)("%s に古い言い方が残っていない", (relative) => {
    const text = read(relative);
    const found = BANNED_VARIANTS.filter((variant) => text.includes(variant));
    expect(found, `${relative}: 発送リードタイムの表記が確定値と食い違う`).toEqual([]);
  });

  it("特商法ページの引渡し時期が確定値になっている", () => {
    expect(read("app/[locale]/legal/tokushoho/page.tsx")).toContain(
      `ご注文から${CONFIRMED_JA}に発送します`
    );
  });

  it("配送ページ・よくあるご質問・商品ページの記載も確定値になっている", () => {
    const ja = JSON.parse(read("messages/ja.json"));
    expect(ja.shipping.facts.rows[0].value).toContain(CONFIRMED_JA);
    expect(ja.shipping.dispatch.rows[0].desc).toContain(CONFIRMED_JA);
    expect(ja.faq.groups[1].items[1].summary).toContain(CONFIRMED_JA);
    expect(ja.productDetail.note1).toContain(CONFIRMED_JA);
    expect(ja.shippingInfo.deliveryTimeText).toContain(CONFIRMED_JA);
    expect(ja.subscriptionLp.faqA2).toContain(CONFIRMED_JA);
  });

  it("英語カタログの発送リードタイムも確定値になっている", () => {
    const en = JSON.parse(read("messages/en.json"));
    expect(en.shipping.facts.rows[0].value).toContain(CONFIRMED_EN);
    expect(en.shipping.dispatch.rows[0].desc).toContain(CONFIRMED_EN);
    expect(en.faq.groups[1].items[1].summary).toContain(CONFIRMED_EN);
    expect(en.shippingInfo.deliveryTimeText).toContain(CONFIRMED_EN);
    expect(en.subscriptionLp.faqA2).toContain(CONFIRMED_EN);
  });
});

describe("定期便の価格表記", () => {
  const FIRST = "1,880";
  const RECURRING = "2,280";

  it("初回特別価格が実ストアの値 (1,880円) になっている", () => {
    for (const relative of ["messages/ja.json", "messages/en.json"] as const) {
      const text = read(relative);
      expect(text, `${relative}: 旧価格 1,480 が残っている`).not.toContain("1,480");
      expect(text, `${relative}: 初回価格の記載が無い`).toContain(FIRST);
    }
  });

  it("特商法ページに初回価格と継続価格が並べて載っている (起草 AC-4)", () => {
    const page = read("app/[locale]/legal/tokushoho/page.tsx");
    const priceItem = page.slice(page.indexOf("各回の代金"));
    expect(priceItem).toContain(FIRST);
    expect(priceItem).toContain(RECURRING);
  });
});

describe("特商法ページ 群 IV (定期便の契約条件)", () => {
  const page = read("app/[locale]/legal/tokushoho/page.tsx");

  it("定期便の群が 1 つ存在する (条件を 1 か所に固める)", () => {
    expect(page).toContain('heading: "IV  定期便について"');
  });

  it("「定期便」「解約」「契約期間」が記載されている (起草 AC-2)", () => {
    for (const word of ["定期便", "解約", "契約期間"]) {
      expect(page, `${word} の記載が無い`).toContain(word);
    }
  });

  it("定期便が送料無料である旨が書かれている (法11条1号)", () => {
    expect(page).toContain("定期便の配送料は無料です");
  });

  it("解約の主たる導線がマイページである旨が書かれている (起草 AC-5)", () => {
    expect(page).toContain("マイページ（アカウント）から、いつでもお客様ご自身で停止・解約");
  });
});

describe("解約・変更の受付期限の統一", () => {
  /**
   * 受付期限を書いてよい唯一の言い方 (確定値 2026-08-11)。
   * 正本は `lib/placeholders.ts` の `tokushoho.subscriptionCancelCutoff`。
   */
  const CONFIRMED = "次回のご請求日の前日";

  /**
   * 差し戻された古い言い方。定期便LP FAQ が「発送日の3日前まで」、
   * リマインドメールが「お届け日の3日前まで」と、特商法ページ (請求日基準) と
   * 別基準のまま残っていた。基準が割れること自体が法12条の観点で問題になるので固定する。
   *
   * 発送リードタイム側の「お届け予定日の3日前に発送します」は解約期限とは別の事実なので
   * 対象にしない (末尾が「まで」の期限表現だけを禁止する)。
   */
  const BANNED_VARIANTS = ["発送日の3日前まで", "お届け日の3日前まで"] as const;

  /** 受付期限が出るユーザー向け文字列の置き場。 */
  const CUTOFF_SURFACES = [
    "messages/ja.json",
    "messages/en.json",
    "app/[locale]/legal/tokushoho/page.tsx",
    "lib/email/subscription-reminder.ts",
  ] as const;

  it.each(CUTOFF_SURFACES)("%s に古い期限表記が残っていない", (relative) => {
    const text = read(relative);
    const found = BANNED_VARIANTS.filter((variant) => text.includes(variant));
    expect(found, `${relative}: 解約・変更の受付期限が確定値と食い違う`).toEqual([]);
  });

  it("特商法ページの受付期限が確定値になっている", () => {
    expect(read("app/[locale]/legal/tokushoho/page.tsx")).toContain("SUB_CANCEL_CUTOFF");
    expect(placeholderValue("tokushoho.subscriptionCancelCutoff")).toBe(CONFIRMED);
  });

  it("定期便LP の FAQ も同じ基準になっている", () => {
    // 実際に描画されている名前空間は `subscriptionR2`
    // (`app/[locale]/subscription/page.tsx` / `app/[locale]/page.tsx`)。
    for (const relative of ["messages/ja.json", "messages/en.json"] as const) {
      const catalog = JSON.parse(read(relative));
      expect(catalog.subscriptionR2.faqA1, `${relative}: FAQ の期限が確定値でない`).toContain(
        CONFIRMED
      );
    }
  });

  it("リマインドメールが期限を直書きせず正本から読んでいる", () => {
    const source = read("lib/email/subscription-reminder.ts");
    expect(source).toContain('placeholderValue("tokushoho.subscriptionCancelCutoff")');
    expect(source).not.toContain(CONFIRMED);
  });
});

describe("問い合わせ先メールの統一", () => {
  /** 画面・構造化データ・自動送信メールに出るアドレス。 */
  const SURFACES = [
    "app/[locale]/legal/privacy/page.tsx",
    "components/seo/json-ld.tsx",
    "lib/email/welcome.ts",
    "app/api/contact/route.ts",
  ] as const;

  it.each(SURFACES)("%s に support@ 表記が残っていない", (relative) => {
    expect(read(relative)).not.toContain("support@elxea.com");
  });
});
