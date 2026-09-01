/**
 * 「まだ答えていない一杯」の決め方を固定する（顧客プロファイル 第1段 ①）。
 *
 * ここが守っているのは設計 §2「無回答の扱い」の 3 行:
 *   - 次の号が出たら前の号は期限切れ（前号までしか遡らない）
 *   - 再掲は最大 2 杯
 *   - 一度答えた／断った一杯は二度と聞かない（追いかけない）
 */
import { describe, expect, it } from "vitest";

import {
  ASKABLE_CUP_LIMIT,
  pickAskableCups,
  pickIssues,
  type IssueForCups,
} from "@/lib/roji/issue-cups";

const issue = (
  slug: string,
  createdAt: string,
  productNumbers: (string | number | null)[],
  featured = false,
): IssueForCups => ({
  slug,
  title: `${slug} の号`,
  featured,
  createdAt,
  teas: productNumbers.map((productNumber, i) => ({
    productNumber,
    title: `${slug}-tea-${i}`,
    displayName: null,
    slug: `${slug}-tea-${i}`,
  })),
});

describe("pickIssues", () => {
  it("featured が立っている号を今号にする", () => {
    const picked = pickIssues([
      issue("sep", "2026-09-01T00:00:00Z", ["10101"]),
      issue("aug", "2026-08-01T00:00:00Z", ["10201"], true),
    ]);
    expect(picked.current?.slug).toBe("aug");
    expect(picked.previous?.slug).toBe("sep");
  });

  it("featured が 1 つも立っていなければ、いちばん新しい号を今号にする", () => {
    const picked = pickIssues([
      issue("jul", "2026-07-01T00:00:00Z", ["10101"]),
      issue("sep", "2026-09-01T00:00:00Z", ["10201"]),
      issue("aug", "2026-08-01T00:00:00Z", ["10301"]),
    ]);
    expect(picked.current?.slug).toBe("sep");
    expect(picked.previous?.slug).toBe("aug");
  });

  it("号が 1 つも無ければ両方 null", () => {
    expect(pickIssues([])).toEqual({ current: null, previous: null });
  });

  it("号が 1 つだけなら前号は無い", () => {
    const picked = pickIssues([issue("sep", "2026-09-01T00:00:00Z", ["10101"])]);
    expect(picked.current?.slug).toBe("sep");
    expect(picked.previous).toBeNull();
  });
});

describe("pickAskableCups", () => {
  const current = issue("sep", "2026-09-01T00:00:00Z", ["10101", "10201", "10301"], true);
  const previous = issue("aug", "2026-08-01T00:00:00Z", ["11301", "11401", "11501"]);

  it("今号は全部聞き、前号の積み残しは 2 杯までにする", () => {
    const cups = pickAskableCups({ current, previous }, new Set());
    expect(cups.map((cup) => cup.productNo)).toEqual([
      "10101",
      "10201",
      "10301",
      "11301",
      "11401",
    ]);
    expect(cups.filter((cup) => cup.issueRef === "aug")).toHaveLength(ASKABLE_CUP_LIMIT);
  });

  it("答えた一杯・断った一杯は二度と出てこない", () => {
    const cups = pickAskableCups({ current, previous }, new Set(["10101", "11301"]));
    expect(cups.map((cup) => cup.productNo)).toEqual(["10201", "10301", "11401", "11501"]);
  });

  it("号をまたいで同じ銘柄が入っていても 1 回しか聞かない", () => {
    const cups = pickAskableCups(
      {
        current: issue("sep", "2026-09-01T00:00:00Z", ["10101"], true),
        previous: issue("aug", "2026-08-01T00:00:00Z", ["10101", "10201"]),
      },
      new Set(),
    );
    expect(cups.map((cup) => cup.productNo)).toEqual(["10101", "10201"]);
    expect(cups[0].issueRef).toBe("sep");
  });

  it("5 桁でない銘柄番号は画面に出さない（L0 が受けない形なので送らない）", () => {
    const cups = pickAskableCups(
      {
        current: issue("sep", "2026-09-01T00:00:00Z", ["10101", 1, "ELX-2026-04", null], true),
        previous: null,
      },
      new Set(),
    );
    expect(cups.map((cup) => cup.productNo)).toEqual(["10101"]);
  });

  it("号が無ければ 1 つも聞かない", () => {
    expect(pickAskableCups({ current: null, previous: null }, new Set())).toEqual([]);
  });

  it("答えの器として号の参照を持ち回る（delivery_ref に載る値）", () => {
    const cups = pickAskableCups({ current, previous: null }, new Set());
    expect(cups.every((cup) => cup.issueRef === "sep")).toBe(true);
  });
});
