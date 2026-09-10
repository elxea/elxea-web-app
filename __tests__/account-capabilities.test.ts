import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ITEMS,
  ACCOUNT_SECTION_ORDER,
  isAvailable,
  isItemAvailable,
  isSignedIn,
  itemsInSection,
  splitSectionItems,
  type AccountAuth,
} from "@/lib/account-capabilities";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * コメントを落としたソース。「この名前が**書かれていない**こと」を縛るときに使う。
 *
 * 撤去した機能は doc コメントに経緯を残すので、素のソースを見ると
 * 「以前は `FollowsSection` を置いていた」という説明文が本物の実装と区別できず、
 * 経緯を書いた瞬間にテストが赤くなる。見るのはコメントを除いた側にする。
 * (`__tests__/account-favorites.test.ts` の同名ヘルパと同じ考え方。)
 *
 * 文字列の中の `//` (URL 等) までは面倒を見ないので、対象ファイルに
 * それが無いことを確かめてから使うこと。
 */
const readCode = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const EMAIL_ONLY: AccountAuth = { shopify: true, line: false };
const LINE_ONLY: AccountAuth = { shopify: false, line: true };
const BOTH: AccountAuth = { shopify: true, line: true };
const SIGNED_OUT: AccountAuth = { shopify: false, line: false };

describe("マイページの項目カタログ", () => {
  it("メールで入った人は、LINE で入った人が見られる項目を必ず全部見られる (上位集合)", () => {
    /* これが今回の非交渉の原則。項目を足すときにここが赤くなるなら、
       その項目は Shopify 側にだけ足されている。 */
    for (const item of ACCOUNT_ITEMS) {
      if (isItemAvailable(item, LINE_ONLY)) {
        expect(
          isItemAvailable(item, EMAIL_ONLY),
          `${item.id} が LINE では見られてメールでは見られない`
        ).toBe(true);
      }
    }
  });

  it("両方連携している人はすべての項目を見られる", () => {
    for (const item of ACCOUNT_ITEMS) {
      expect(isItemAvailable(item, BOTH), item.id).toBe(true);
    }
  });

  it("ログインしていない人はどの項目も見られない", () => {
    expect(isSignedIn(SIGNED_OUT)).toBe(false);
    for (const item of ACCOUNT_ITEMS) {
      expect(isItemAvailable(item, SIGNED_OUT), item.id).toBe(false);
    }
  });

  it("「フォロー中の農家」の項目はもう無い (お気に入りの 4 分類目へ統合・J-5)", () => {
    /* 農家は `favorites` の `type: "farmer"` になったので、独立した項目・節を
       持たない。カタログに `follows` が復活すると、画面に「別の動詞」が戻る。 */
    expect(ACCOUNT_ITEMS.map((item) => item.id)).not.toContain("follows");
    expect(ACCOUNT_SECTION_ORDER as readonly string[]).not.toContain("follows");
  });

  it("お気に入り・イベント申込も両方の経路で見られる (Firestore 側の情報)", () => {
    for (const id of ["favorites", "events"] as const) {
      expect(isAvailable(id, LINE_ONLY), id).toBe(true);
      expect(isAvailable(id, EMAIL_ONLY), id).toBe(true);
    }
  });

  it("Shopify の顧客トークンが要る項目は LINE 単独では使えない (安全境界)", () => {
    /* 注文履歴・定期便・お支払い方法を LINE セッションで出す実装をしない。
       LINE ログインでは Shopify の顧客トークンが構造上得られないため。 */
    for (const id of ["orders", "subscriptions", "payment"] as const) {
      expect(isAvailable(id, LINE_ONLY), id).toBe(false);
      expect(isAvailable(id, EMAIL_ONLY), id).toBe(true);
    }
  });

  it("使えない項目は消えず、理由と (必要なら) 次の行動を持つ", () => {
    for (const section of ACCOUNT_SECTION_ORDER) {
      for (const item of splitSectionItems(section, LINE_ONLY).locked) {
        expect(item.lockedTitleKey, item.id).toBeTruthy();
        expect(item.lockedReasonKey, item.id).toBeTruthy();
      }
    }
    /* Shopify が要る項目は必ず次の行動を持つ (行き止まりにしない)。 */
    for (const item of ACCOUNT_ITEMS.filter((i) => i.requires === "shopify")) {
      expect(item.lockedAction, item.id).toBeTruthy();
      expect(item.lockedAction?.labelKey, item.id).toBeTruthy();
      expect(item.lockedAction?.target, item.id).toBeTruthy();
    }
  });

  it("すべての項目はいずれかの節に属し、節はすべて並び順に載っている", () => {
    for (const item of ACCOUNT_ITEMS) {
      expect(ACCOUNT_SECTION_ORDER, item.id).toContain(item.section);
    }
    for (const section of ACCOUNT_SECTION_ORDER) {
      expect(itemsInSection(section).length, section).toBeGreaterThan(0);
    }
  });

  it("文言キーはすべて messages/ja.json と en.json の account 配下に実在する", () => {
    const keys: string[] = ACCOUNT_ITEMS.flatMap((item) => {
      const candidates: (string | null)[] = [
        item.lockedTitleKey,
        item.lockedReasonKey,
        item.lockedAction?.labelKey ?? null,
      ];
      return candidates.filter((key): key is string => key !== null);
    });

    for (const locale of ["ja", "en"] as const) {
      const account = JSON.parse(read(`messages/${locale}.json`)).account as Record<
        string,
        unknown
      >;
      for (const key of keys) {
        expect(typeof account[key], `${locale}.json account.${key}`).toBe("string");
      }
    }
  });
});

describe("マイページはログイン経路で画面ごと切り替えない", () => {
  const page = read("app/[locale]/account/page.tsx");

  it("LINE 専用のマイページ実装は残っていない", () => {
    /* 経緯は doc コメントに残すので、名前の出現ではなく import と実体で見る。 */
    expect(page).not.toMatch(/^import .*line-account-view/m);
    expect(page).not.toMatch(/<LineAccountView/);
    expect(() => read("components/account/line-account-view.tsx")).toThrow();
  });

  it("マイページはカタログの並び順を読んで節を出している", () => {
    expect(page).toContain("ACCOUNT_SECTION_ORDER");
    expect(page).toContain("account-capabilities");
  });

  /**
   * 「フォロー中の農家」の節は撤去し、農家はお気に入りの 4 分類目にした (J-5)。
   *
   * 経緯は doc コメントに残すので、名前の出現ではなく **実体** で見る
   * (`readCode` でコメントを落とした側を見る)。節・部品・文言のどれか 1 つでも
   * 戻ると、利用者から見て「別の動詞」が画面に復活する。
   */
  it("「フォロー中の農家」の節はもう無い (お気に入りへ統合・J-5)", () => {
    const code = readCode("app/[locale]/account/page.tsx");
    expect(code).not.toContain("FollowsSection");
    expect(code).not.toContain("followingFarmers");
    expect(() => read("components/account/follows-section.tsx")).toThrow();
    expect(() => read("components/farmers/follow-button.tsx")).toThrow();
    expect(() => read("app/api/user/follows/route.ts")).toThrow();
  });

  /**
   * お気に入りはマイページ本体で **分類ごとに直接** 出す。
   * 「続き」の抜粋 6 枚 + 「お気に入りをすべて見る」リンクという
   * ワンクッションは廃止した (Setaka 実機指摘 2026-08-25)。
   */
  it("お気に入りは抜粋ではなく分類ごとに本体へ出す", () => {
    const code = readCode("app/[locale]/account/page.tsx");
    expect(code).toContain("FavoritesBoard");
    expect(code).not.toContain("continueAll");
    expect(code).not.toContain("continueHeading");
    expect(code).not.toContain("buildContinueItems");
  });
});

describe("定期便ページはログイン済みの人にログインを求めない", () => {
  const page = read("app/[locale]/account/subscriptions/page.tsx");

  it("ログイン済みなら「メール連携が必要」を出し、未ログインのときだけログインを促す", () => {
    expect(page).toContain("isSignedIn");
    expect(page).toContain("subscriptionsEmailRequired");
    expect(page).toContain("loginRequired");
  });
});

describe("LINE の判定は httpOnly cookie を主軸にする", () => {
  const page = read("app/[locale]/account/page.tsx");

  it("line_session だけで判定し、表示名 cookie を認証条件に混ぜない", () => {
    /* Wave 4 で判定が共通関数に移った (`lib/auth/cookies.ts`)。以前ここは
       `cookieStore.has("line_session")` という**生の文字列**を期待していたが、
       それはこの画面が判定を自前で持っていることを前提にした固定であり、
       共通化すると必ず落ちる。見たいのは「どの cookie を見ているか」なので、
       共通判定を通していることを期待する。
       判定の中身 (`line_session` だけを見る) は
       `__tests__/session-mirror-parity.test.ts` が関数の側で固定している。 */
    expect(page).toMatch(/readSessionMirror|hasLineSessionCookies/);
    /* line_user (非 httpOnly) は表示名の取得にのみ使う。認証条件に AND で
       混ぜると、cookie が消えただけでログイン済みの人が締め出される。 */
    expect(page).not.toMatch(/hasLineSession\s*&&\s*lineDisplayName/);
  });
});
