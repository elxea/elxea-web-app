import { describe, expect, it } from "vitest";

import {
  PREFECTURES,
  isPrefecture,
  prefectureOrder,
} from "@/lib/roji/prefectures";
import {
  TEA_MENU_NUMBERS,
  prefecturesFromMenuNumbers,
  resolveTeaOrigin,
  resolveTeaSupplier,
  teaCountByPrefecture,
} from "@/lib/roji/tea-origins";

describe("prefectures", () => {
  it("47 件ちょうどで重複が無い", () => {
    expect(PREFECTURES).toHaveLength(47);
    expect(new Set(PREFECTURES).size).toBe(47);
  });

  it("全国地方公共団体コード順 (北から南) で始まり終わる", () => {
    expect(PREFECTURES[0]).toBe("北海道");
    expect(PREFECTURES[46]).toBe("沖縄県");
  });

  it("全て正式名称 (都/道/府/県 で終わる)", () => {
    for (const p of PREFECTURES) {
      expect(p).toMatch(/(都|道|府|県)$/);
    }
  });

  it("短縮形・空文字・未知の値を弾く", () => {
    expect(isPrefecture("京都")).toBe(false);
    expect(isPrefecture("")).toBe(false);
    expect(isPrefecture("東京")).toBe(false);
    expect(isPrefecture("Shizuoka")).toBe(false);
    expect(isPrefecture("京都府")).toBe(true);
  });

  it("prefectureOrder は未知の値に -1 を返す", () => {
    expect(prefectureOrder("北海道")).toBe(0);
    expect(prefectureOrder("沖縄県")).toBe(46);
    expect(prefectureOrder("京都")).toBe(-1);
  });
});

describe("tea-origins", () => {
  it("銘柄番号は全て 5 桁の数字", () => {
    expect(TEA_MENU_NUMBERS.length).toBeGreaterThan(0);
    for (const n of TEA_MENU_NUMBERS) {
      expect(n).toMatch(/^\d{5}$/);
    }
  });

  it("銘柄番号に重複が無い", () => {
    expect(new Set(TEA_MENU_NUMBERS).size).toBe(TEA_MENU_NUMBERS.length);
  });

  it("Notion 棚卸し (2026-08-12) と同じ 43 件を持つ", () => {
    expect(TEA_MENU_NUMBERS).toHaveLength(43);
  });

  it("全エントリの prefecture が 47 都道府県のいずれか or null", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { prefecture } = resolveTeaOrigin(n);
      if (prefecture !== null) {
        expect(isPrefecture(prefecture)).toBe(true);
      }
    }
  });

  it("prefecture が null のときだけ needsReview が立つ", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { prefecture, needsReview } = resolveTeaOrigin(n);
      expect(needsReview).toBe(prefecture === null);
    }
  });

  it("現時点では needsReview のエントリが無い (全件 Notion の Prefecture で確定)", () => {
    const pending = TEA_MENU_NUMBERS.filter((n) => resolveTeaOrigin(n).needsReview);
    expect(pending).toEqual([]);
  });

  it("prefecture が引けたエントリは area と raw も持つ", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { prefecture, area, raw } = resolveTeaOrigin(n);
      if (prefecture === null) continue;
      expect(area).toBeTruthy();
      expect(raw).toBeTruthy();
    }
  });

  it("raw は必ず自身の prefecture 名から始まる (仕入先の取り違え検知)", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { prefecture, raw } = resolveTeaOrigin(n);
      if (prefecture === null || raw === null) continue;
      expect(raw.startsWith(prefecture)).toBe(true);
    }
  });

  it("area は都道府県名を含まない (raw から接頭辞を落とし切れている)", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { prefecture, area } = resolveTeaOrigin(n);
      if (prefecture === null || area === null) continue;
      expect(area).not.toContain(prefecture);
      expect(area.trim()).toBe(area);
    }
  });

  it("全エントリに仕入先が紐づく", () => {
    for (const n of TEA_MENU_NUMBERS) {
      expect(resolveTeaSupplier(n)).toBeTruthy();
    }
  });

  it("既知の代表値を正しく引く", () => {
    // 11301 = やぶきたの上煎茶 / みとちゃ農園 (奈良県 山添村)
    expect(resolveTeaOrigin("11301")).toEqual({
      prefecture: "奈良県",
      area: "山添村",
      raw: "奈良県 山添村",
      needsReview: false,
    });
    // 51001 = 春摘みべにふうきの和紅茶 / つしま大石農園 (長崎県 対馬市 上県町)
    expect(resolveTeaOrigin("51001")).toEqual({
      prefecture: "長崎県",
      area: "対馬市上県町",
      raw: "長崎県 対馬市 上県町",
      needsReview: false,
    });
    expect(resolveTeaSupplier("10701")).toBe("中窪製茶園");
  });

  it("未知の番号は例外を投げず needsReview を返す", () => {
    for (const bogus of ["99999", "", "1130", "113010", "abcde"]) {
      expect(resolveTeaOrigin(bogus)).toEqual({
        prefecture: null,
        area: null,
        raw: null,
        needsReview: true,
      });
      expect(resolveTeaSupplier(bogus)).toBeNull();
    }
  });
});

describe("prefecturesFromMenuNumbers", () => {
  it("重複を畳んで灯す県の集合を返す", () => {
    // 10101 と 10102 はどちらも しばきり園 (静岡県)
    expect(prefecturesFromMenuNumbers(["10101", "10102", "11301"])).toEqual(
      new Set(["静岡県", "奈良県"])
    );
  });

  it("未知の番号は黙って捨てる", () => {
    expect(prefecturesFromMenuNumbers(["99999", "11301"])).toEqual(new Set(["奈良県"]));
    expect(prefecturesFromMenuNumbers([])).toEqual(new Set());
  });

  it("全銘柄を渡すと 9 県が灯る", () => {
    expect(prefecturesFromMenuNumbers(TEA_MENU_NUMBERS).size).toBe(9);
  });
});

describe("teaCountByPrefecture", () => {
  it("件数の合計が prefecture を持つ銘柄数と一致する", () => {
    const counts = teaCountByPrefecture();
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const resolved = TEA_MENU_NUMBERS.filter((n) => resolveTeaOrigin(n).prefecture !== null);
    expect(total).toBe(resolved.length);
    expect(total).toBe(43);
  });

  it("棚卸し時点の分布と一致する", () => {
    const counts = teaCountByPrefecture();
    expect(Object.fromEntries(counts)).toEqual({
      静岡県: 14,
      福岡県: 9,
      宮崎県: 7,
      熊本県: 5,
      奈良県: 2,
      三重県: 2,
      茨城県: 2,
      京都府: 1,
      長崎県: 1,
    });
  });

  it("キーは全て 47 都道府県のいずれか", () => {
    for (const p of teaCountByPrefecture().keys()) {
      expect(isPrefecture(p)).toBe(true);
    }
  });
});
