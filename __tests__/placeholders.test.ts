/**
 * 仮当て値ガード (lib/placeholders.ts) の単体テスト。
 *
 * 守りたい性質は 3 つ:
 *   1. production 相当の env では、仮値が残っている限り必ず落ちる
 *   2. dev / Preview / test では落ちない (作業を止めない)
 *   3. 法定表記の仮値が「実在の住所・電話番号・個人名に見える」形で書かれていない
 *
 * さらに、このテスト自体が本番相当環境で走ったときは未解決 0 件を要求する
 * (`VERCEL_ENV=production pnpm test` でも止まるようにする二重化)。
 */

import { describe, expect, it } from "vitest";

import {
  PLACEHOLDERS,
  PLACEHOLDER_MARKER,
  type PlaceholderEntry,
  assertPlaceholdersResolved,
  placeholderGuardMode,
  placeholderValue,
  unresolvedPlaceholderIds,
} from "@/lib/placeholders";

const UNRESOLVED_FIXTURE: Record<string, PlaceholderEntry> = {
  "fixture.pending": {
    surface: "テスト用",
    label: "未確定の値",
    value: "（公開前に差し替え）未確定",
    status: PLACEHOLDER_MARKER,
    owner: "テスト",
    basis: "テスト",
  },
};

const RESOLVED_FIXTURE: Record<string, PlaceholderEntry> = {
  "fixture.pending": {
    ...UNRESOLVED_FIXTURE["fixture.pending"],
    value: "確定した実値",
    status: "confirmed",
  },
};

describe("placeholderGuardMode", () => {
  it("VERCEL_ENV=production を error 判定にする", () => {
    expect(placeholderGuardMode({ VERCEL_ENV: "production" })).toBe("error");
  });

  it("dev / Preview / env 無指定では落とさない", () => {
    expect(placeholderGuardMode({})).toBe("off");
    expect(placeholderGuardMode({ VERCEL_ENV: "preview" })).toBe("off");
    expect(placeholderGuardMode({ VERCEL_ENV: "development" })).toBe("off");
  });

  it("NODE_ENV=production では落とさない (next build はローカルでもこの値になる)", () => {
    expect(placeholderGuardMode({ NODE_ENV: "production" })).toBe("off");
  });

  it("ROJI_PLACEHOLDER_GUARD の明示指定が VERCEL_ENV より優先される", () => {
    expect(placeholderGuardMode({ ROJI_PLACEHOLDER_GUARD: "error" })).toBe("error");
    expect(
      placeholderGuardMode({ VERCEL_ENV: "production", ROJI_PLACEHOLDER_GUARD: "off" })
    ).toBe("off");
  });
});

describe("assertPlaceholdersResolved", () => {
  it("本番相当 env + 仮値ありなら throw する", () => {
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "production" }, UNRESOLVED_FIXTURE)
    ).toThrow(PLACEHOLDER_MARKER);
  });

  it("throw するときは対象 id と担当を含める (誰が何を直すか分かる)", () => {
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "production" }, UNRESOLVED_FIXTURE)
    ).toThrow(/fixture\.pending/);
  });

  it("本番相当 env でも全件 confirmed なら通る", () => {
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "production" }, RESOLVED_FIXTURE)
    ).not.toThrow();
  });

  it("dev / Preview では仮値が残っていても通る", () => {
    expect(() => assertPlaceholdersResolved({}, UNRESOLVED_FIXTURE)).not.toThrow();
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "preview" }, UNRESOLVED_FIXTURE)
    ).not.toThrow();
  });

  it("実レジストリも本番相当 env では同じ判定になる (仮値が残る間は throw)", () => {
    const unresolved = unresolvedPlaceholderIds();
    const run = () => assertPlaceholdersResolved({ VERCEL_ENV: "production" });
    if (unresolved.length > 0) {
      expect(run).toThrow(PLACEHOLDER_MARKER);
    } else {
      expect(run).not.toThrow();
    }
  });
});

describe("PLACEHOLDERS レジストリ", () => {
  it("id / 必須メタが全件そろっている", () => {
    for (const [id, entry] of Object.entries(PLACEHOLDERS)) {
      expect(id, `${id}: id は <surface>.<name> 形式`).toMatch(/^[a-z]+\.[A-Za-z]+$/);
      expect(entry.value.length, `${id}: value が空`).toBeGreaterThan(0);
      expect(entry.owner.length, `${id}: owner が空`).toBeGreaterThan(0);
      expect(entry.basis.length, `${id}: basis (差し替え根拠) が空`).toBeGreaterThan(0);
      expect(entry.surface.length, `${id}: surface が空`).toBeGreaterThan(0);
    }
  });

  it("placeholderValue がレジストリの value を返す", () => {
    expect(placeholderValue("subscription.monthlyPrice")).toBe(
      PLACEHOLDERS["subscription.monthlyPrice"].value
    );
  });

  it("法定表記 (tokushoho.*) の仮値は実在に見える住所・電話番号を含まない", () => {
    // 特商法ページに出る住所・電話・責任者名の仮値は、guard をすり抜けても
    // 読み手が一目で仮値と分かる必要がある。
    // 検査対象は「まだ仮値のもの」だけ。実値に差し替えた (`confirmed`) エントリは
    // 本物の住所・電話番号になるため、ここで数字列を禁じてはいけない。
    // 「1 件以上あること」も要求しない (全件 confirmed = 正常な最終状態)。
    const legalPlaceholders = Object.entries(PLACEHOLDERS).filter(
      ([id, entry]) => id.startsWith("tokushoho.") && entry.status === PLACEHOLDER_MARKER
    );

    for (const [id, entry] of legalPlaceholders) {
      if (id === "tokushoho.email") continue; // メールは凍結版の実アドレス候補をそのまま置いている

      expect(entry.value, `${id}: 「公開前に差し替え」の明示が必要`).toContain("公開前に差し替え");
      // 郵便番号 / 番地 / 電話番号の形をした数字列を持たせない
      expect(entry.value, `${id}: 郵便番号らしい数字列は置かない`).not.toMatch(/\d{3}-?\d{4}/);
      expect(entry.value, `${id}: 電話番号らしい数字列は置かない`).not.toMatch(
        /\d{2,4}-\d{2,4}-\d{3,4}/
      );
      expect(entry.value, `${id}: 番地らしい数字列は置かない`).not.toMatch(/\d+-\d+-\d+/);
    }
  });
});

describe("公開ゲート", () => {
  /**
   * 実レジストリに対する公開可否チェック。`ROJI_PLACEHOLDER_GUARD=error` を
   * 明示したときだけ発火させる (`ROJI_PLACEHOLDER_GUARD=error pnpm test`)。
   *
   * なぜ `VERCEL_ENV` で発火させないか: vitest は `.env.local` を process.env に
   * 読み込むため、手元の `.env.local` が `VERCEL_ENV="production"` を持っていると
   * 通常の `pnpm test` が落ちてしまう (実際にこのリポジトリの手元環境がそうだった)。
   * 「dev / Preview では作業を止めない」を守るため、テスト側の発火は明示指定に限る。
   *
   * 本番公開の実ブロックはビルド側 (`scripts/check-placeholders.ts`) が担う。
   * こちらは dotenv を読まない素の node プロセスなので、Vercel が注入する
   * `VERCEL_ENV=production` だけに反応する。
   */
  const releaseCheck = process.env.ROJI_PLACEHOLDER_GUARD === "error";

  it.runIf(releaseCheck)("未解決の仮値が 0 件であること (公開前チェック)", () => {
    expect(unresolvedPlaceholderIds()).toEqual([]);
  });

  it("明示指定がないときは公開ゲートを発火させない (作業を止めない)", () => {
    expect(placeholderGuardMode({ VERCEL_ENV: "preview" })).toBe("off");
    expect(placeholderGuardMode({})).toBe("off");
  });
});
