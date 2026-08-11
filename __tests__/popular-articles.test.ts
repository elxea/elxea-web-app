import { describe, it, expect } from "vitest";

import { orderByPopularity } from "@/lib/journal/popular-articles";

type Article = { _id: string; slug: { current: string } };

const a = (id: string): Article => ({ _id: id, slug: { current: id } });

describe("orderByPopularity", () => {
  it("人気データが無ければ元の並びをそのまま返す", () => {
    const list = [a("one"), a("two"), a("three")];
    expect(orderByPopularity(list, []).map((x) => x._id)).toEqual(["one", "two", "three"]);
  });

  it("閲覧数の多い順に前へ寄せる", () => {
    const list = [a("one"), a("two"), a("three")];
    const popular = [
      { slug: "three", views: 10 },
      { slug: "one", views: 4 },
    ];
    expect(orderByPopularity(list, popular).map((x) => x._id)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  it("人気データに無い記事は元の並びを保ったまま後ろへ回る", () => {
    const list = [a("one"), a("two"), a("three"), a("four")];
    const popular = [{ slug: "four", views: 9 }];
    expect(orderByPopularity(list, popular).map((x) => x._id)).toEqual([
      "four",
      "one",
      "two",
      "three",
    ]);
  });

  it("取得済みの記事に無いスラッグは無視する (窓の外は引き当て直さない)", () => {
    const list = [a("one"), a("two")];
    const popular = [
      { slug: "not-in-window", views: 99 },
      { slug: "two", views: 3 },
    ];
    expect(orderByPopularity(list, popular).map((x) => x._id)).toEqual(["two", "one"]);
  });

  it("元の配列を破壊しない", () => {
    const list = [a("one"), a("two")];
    orderByPopularity(list, [{ slug: "two", views: 5 }]);
    expect(list.map((x) => x._id)).toEqual(["one", "two"]);
  });
});
