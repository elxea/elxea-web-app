/**
 * `public/fictional-content.json` (アセットハブが読む配信物) の契約テスト。
 *
 * 守っているのは 3 つ:
 *   1. 配信物が SoT (`lib/fictional-content.ts`) と 1 バイト単位で一致している。
 *      ここが緩むと「サイトでは隠れているのにアセットハブには空き枠として出る」が
 *      再発する (2026-09-14 の生産者 4 件 / イベント 4 件がまさにそれ)。
 *   2. 配信物に **すべての** deny-list 項目が入っている。読み手は id と slug の
 *      両方で引ける必要がある (一覧は _id / 詳細と sitemap は slug しか持たない)。
 *   3. 隠さないと決めたもの (author / playlist) が配信物にも現れない。
 *
 * これは deny-list の中身そのもののテスト (`fictional-content.test.ts`) ではなく、
 * **中身が外まで届いているか**のテスト。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  FICTIONAL_DOC_TYPES,
  fictionalIds,
  fictionalSlugs,
} from "@/lib/fictional-content";
import {
  FICTIONAL_JSON_PATH,
  buildFictionalContentDocument,
  renderFictionalContentJson,
} from "@/scripts/gen-fictional-content";
import { checkFictionalContent } from "@/scripts/check-fictional-content";

const published = JSON.parse(
  readFileSync(FICTIONAL_JSON_PATH, "utf8"),
) as ReturnType<typeof buildFictionalContentDocument>;

describe("public/fictional-content.json", () => {
  it("is byte-identical to what the SoT generates", () => {
    expect(readFileSync(FICTIONAL_JSON_PATH, "utf8")).toBe(
      renderFictionalContentJson(),
    );
  });

  it("passes the build gate that runs before `next build`", () => {
    expect(checkFictionalContent()).toEqual([]);
  });

  it("publishes exactly the doc types the deny-list covers", () => {
    expect(Object.keys(published.docTypes).sort()).toEqual(
      [...FICTIONAL_DOC_TYPES].sort(),
    );
  });

  it("publishes every denied id and slug of every covered type", () => {
    for (const type of FICTIONAL_DOC_TYPES) {
      expect(new Set(published.docTypes[type].ids)).toEqual(fictionalIds(type));
      expect(new Set(published.docTypes[type].slugs)).toEqual(
        fictionalSlugs(type),
      );
    }
  });

  it("carries the eight documents the asset hub was wrongly offering as slots", () => {
    // 生産者 4 件 (佐藤 美咲 / 山田 健一 / 山田農園 / 田中茶園)
    expect(published.docTypes.farmer.slugs).toEqual(
      expect.arrayContaining([
        "sato-misaki",
        "yamada-kenichi",
        "yamada-farm",
        "tanaka-tea-garden",
      ]),
    );
    // イベント 4 件
    expect(published.docTypes.event.slugs).toEqual(
      expect.arrayContaining([
        "beginners-tea-workshop",
        "2026-taiwan-oolong-workshop",
        "2026-spring-tasting",
        "spring-tea-tasting-2026",
      ]),
    );
  });

  it("does not publish the types Setaka decided to leave visible", () => {
    // author (author-setaka / author-roji) と playlist は意図的に非 deny。
    // 配信物に出た時点で、隠さないという決定が黙って覆っている。
    expect(published.docTypes).not.toHaveProperty("author");
    expect(published.docTypes).not.toHaveProperty("playlist");
    const flat = JSON.stringify(published.docTypes);
    for (const id of ["author-setaka", "author-roji"]) {
      expect(flat).not.toContain(id);
    }
  });

  it("is served from public/ so production can hand it to the asset hub", () => {
    expect(path.basename(FICTIONAL_JSON_PATH)).toBe("fictional-content.json");
    expect(path.basename(path.dirname(FICTIONAL_JSON_PATH))).toBe("public");
  });
});
