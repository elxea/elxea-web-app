/**
 * 仮当て値ガード (lib/placeholders.ts) の単体テスト。
 *
 * 守りたい性質は 3 つ:
 *   1. **全環境で** 仮値が残っている限り必ず落ちる (2026-08-12 Setaka 決定)
 *   2. 抜け道は `ROJI_PLACEHOLDER_GUARD=off` の明示指定だけ
 *   3. 法定表記の仮値が「実在の住所・電話番号・個人名に見える」形で書かれていない
 *
 * 旧仕様 (`VERCEL_ENV=production` のときだけ落とす) は Preview を通してしまい、
 * 本番デプロイで初めて落ちるためガード無効化が常用されていた。環境差を無くしたので
 * このテストも env による分岐を持たない。
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
  it("env 無指定でも error 判定にする (既定で落とす)", () => {
    expect(placeholderGuardMode({})).toBe("error");
  });

  it("production / Preview / dev を区別しない (全環境で error)", () => {
    expect(placeholderGuardMode({ VERCEL_ENV: "production" })).toBe("error");
    expect(placeholderGuardMode({ VERCEL_ENV: "preview" })).toBe("error");
    expect(placeholderGuardMode({ VERCEL_ENV: "development" })).toBe("error");
    expect(placeholderGuardMode({ NODE_ENV: "production" })).toBe("error");
    expect(placeholderGuardMode({ NODE_ENV: "test" })).toBe("error");
  });

  it("ROJI_PLACEHOLDER_GUARD=off だけが唯一の逃げ道", () => {
    expect(placeholderGuardMode({ ROJI_PLACEHOLDER_GUARD: "off" })).toBe("off");
    expect(
      placeholderGuardMode({ VERCEL_ENV: "production", ROJI_PLACEHOLDER_GUARD: "off" })
    ).toBe("off");
  });

  it("ROJI_PLACEHOLDER_GUARD=error は既定と同じ (後方互換)", () => {
    expect(placeholderGuardMode({ ROJI_PLACEHOLDER_GUARD: "error" })).toBe("error");
  });

  it("未知の値は既定 (error) にフォールバックする — 誤記でガードが外れない", () => {
    expect(placeholderGuardMode({ ROJI_PLACEHOLDER_GUARD: "OFF" })).toBe("error");
    expect(placeholderGuardMode({ ROJI_PLACEHOLDER_GUARD: "false" })).toBe("error");
  });
});

describe("assertPlaceholdersResolved", () => {
  it("仮値ありなら throw する (env 指定なしでも)", () => {
    expect(() => assertPlaceholdersResolved({}, UNRESOLVED_FIXTURE)).toThrow(
      PLACEHOLDER_MARKER
    );
  });

  it("throw するときは対象 id と担当を含める (誰が何を直すか分かる)", () => {
    expect(() => assertPlaceholdersResolved({}, UNRESOLVED_FIXTURE)).toThrow(
      /fixture\.pending/
    );
  });

  it("Preview でも仮値ありなら throw する (旧仕様との差はここ)", () => {
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "preview" }, UNRESOLVED_FIXTURE)
    ).toThrow(PLACEHOLDER_MARKER);
  });

  it("全件 confirmed なら通る", () => {
    expect(() => assertPlaceholdersResolved({}, RESOLVED_FIXTURE)).not.toThrow();
    expect(() =>
      assertPlaceholdersResolved({ VERCEL_ENV: "production" }, RESOLVED_FIXTURE)
    ).not.toThrow();
  });

  it("guard=off を明示したときだけ仮値が残っていても通る", () => {
    expect(() =>
      assertPlaceholdersResolved({ ROJI_PLACEHOLDER_GUARD: "off" }, UNRESOLVED_FIXTURE)
    ).not.toThrow();
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
    expect(placeholderValue("subscription.firstDeliveryDate")).toBe(
      PLACEHOLDERS["subscription.firstDeliveryDate"].value
    );
  });

  it("月額はレジストリに置かない (Shopify の selling plan が SoT)", () => {
    // 定数に戻すと Shopify 側の価格改定が画面に反映されず、表示額と請求額が
    // 食い違う。導出は lib/subscription-pricing.ts が行う。
    expect(Object.keys(PLACEHOLDERS)).not.toContain("subscription.monthlyPrice");
  });

  it("会社の所在地・電話番号の仮値は実在に見える文字列を含まない", () => {
    // 特商法ページ / About ページに出る住所・電話・責任者名の仮値は、guard を
    // すり抜けても読み手が一目で仮値と分かる必要がある。
    // 検査対象は「まだ仮値のもの」だけ。実値に差し替えた (`confirmed`) エントリは
    // 本物の住所・電話番号になるため、ここで数字列を禁じてはいけない。
    // 「1 件以上あること」も要求しない (全件 confirmed = 正常な最終状態)。
    //
    // `PlaceholderEntry` に widen して読む理由: 現在は全件 `confirmed` なので
    // `PLACEHOLDERS` の `status` はリテラル型 `"confirmed"` に推論され、
    // `=== PLACEHOLDER_MARKER` が「型が重ならない比較」(TS2367) になる。仮値が
    // 1 件でも復活すれば必要になる検査なので、比較を消さずに型だけ広げる。
    const entries: Record<string, PlaceholderEntry> = PLACEHOLDERS;
    const legalPlaceholders = Object.entries(entries).filter(
      ([id, entry]) =>
        (id.startsWith("tokushoho.") || id.startsWith("about.")) &&
        entry.status === PLACEHOLDER_MARKER
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
   * 実レジストリに対する公開可否チェック。全環境でガードが有効になったので、
   * env による分岐 (旧: `ROJI_PLACEHOLDER_GUARD=error` を明示したときだけ発火) は
   * 廃止し、常に未解決 0 件を要求する。
   *
   * これが落ちたら「新しい仮値が入ったまま」= そのブランチは公開できない状態。
   * 意図して仮値を入れて作業を進めるなら `ROJI_PLACEHOLDER_GUARD=off pnpm test`。
   */
  it("未解決の仮値が 0 件であること (公開前チェック)", () => {
    expect(unresolvedPlaceholderIds()).toEqual([]);
  });

  it("ビルドゲートと同じ判定関数を使っている (二重管理しない)", () => {
    expect(placeholderGuardMode(process.env)).toBe(
      process.env.ROJI_PLACEHOLDER_GUARD === "off" ? "off" : "error"
    );
  });
});
