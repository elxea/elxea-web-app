import { describe, expect, it } from "vitest";

import {
  PREFECTURES,
  isPrefecture,
  prefectureOrder,
} from "@/lib/roji/prefectures";
import {
  TEA_MENU_NUMBERS,
  originPrecisionBreakdown,
  prefecturesFromMenuNumbers,
  resolveTeaOrigin,
  resolveTeaSupplier,
  teaCountByPrefecture,
  teaOriginPoints,
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
    // 座標は正本 = Notion Supplier List の Place。
    expect(resolveTeaOrigin("11301")).toEqual({
      prefecture: "奈良県",
      area: "山添村",
      raw: "奈良県 山添村",
      lat: 34.68088,
      lng: 136.04343,
      precision: "area",
      geoTitle: "奈良県山辺郡山添村",
      needsReview: false,
    });
    // 51001 = 春摘みべにふうきの和紅茶 / つしま大石農園 (長崎県 対馬市 上県町)
    // 正本を採らない唯一の例外。Notion の Place は対馬市全体の重心で、島の
    // 南北 80km のうち南部を指してしまうため、GSI の上県町の代表点を残している。
    expect(resolveTeaOrigin("51001")).toEqual({
      prefecture: "長崎県",
      area: "対馬市上県町",
      raw: "長崎県 対馬市 上県町",
      lat: 34.566456,
      lng: 129.333176,
      precision: "area",
      geoTitle: "長崎県対馬市上県町伊奈",
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
        lat: null,
        lng: null,
        precision: "none",
        geoTitle: null,
        needsReview: true,
      });
      expect(resolveTeaSupplier(bogus)).toBeNull();
    }
  });
});

describe("座標 (Mapbox 用)", () => {
  it("lat は日本の緯度範囲 (24〜46) 内 or null", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lat } = resolveTeaOrigin(n);
      if (lat === null) continue;
      expect(lat).toBeGreaterThanOrEqual(24);
      expect(lat).toBeLessThanOrEqual(46);
    }
  });

  it("lng は日本の経度範囲 (122〜154) 内 or null", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lng } = resolveTeaOrigin(n);
      if (lng === null) continue;
      expect(lng).toBeGreaterThanOrEqual(122);
      expect(lng).toBeLessThanOrEqual(154);
    }
  });

  it("lat と lng は必ず揃って存在するか、揃って null", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lat, lng } = resolveTeaOrigin(n);
      expect(lat === null).toBe(lng === null);
    }
  });

  it("precision と座標の有無が矛盾しない", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lat, precision, geoTitle } = resolveTeaOrigin(n);
      if (lat === null) {
        expect(precision).toBe("none");
        expect(geoTitle).toBeNull();
      } else {
        expect(precision === "area" || precision === "prefecture").toBe(true);
        expect(geoTitle).toBeTruthy();
      }
    }
  });

  it("座標があれば needsReview は立たない (逆も然り)", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lat, prefecture, needsReview } = resolveTeaOrigin(n);
      expect(needsReview).toBe(lat === null || prefecture === null);
    }
  });

  it("緯度と経度の取り違えが無い (日本では常に lng > lat)", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { lat, lng } = resolveTeaOrigin(n);
      if (lat === null || lng === null) continue;
      expect(lng).toBeGreaterThan(lat);
    }
  });

  it("area 粒度のエントリは area 名を持つ", () => {
    for (const n of TEA_MENU_NUMBERS) {
      const { precision, area } = resolveTeaOrigin(n);
      if (precision !== "area") continue;
      expect(area).toBeTruthy();
    }
  });

  it("棚卸し時点では全 43 件が area 粒度 (prefecture 代用・欠損なし)", () => {
    expect(originPrecisionBreakdown()).toEqual({
      area: 43,
      prefecture: 0,
      none: 0,
    });
  });
});

describe("teaOriginPoints", () => {
  it("同じ座標の銘柄を 1 点に畳む", () => {
    // 10101 と 10102 はどちらも しばきり園 (静岡市) で同一座標
    const points = teaOriginPoints(["10101", "10102"]);
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      menuNumber: "10101",
      prefecture: "静岡県",
      area: "静岡市",
      lat: 34.97516,
      lng: 138.38324,
      precision: "area",
    });
  });

  it("別産地は別の点になる", () => {
    expect(teaOriginPoints(["10101", "11301"])).toHaveLength(2);
  });

  it("座標の無い銘柄は捨てる", () => {
    expect(teaOriginPoints(["99999", "11301"])).toHaveLength(1);
    expect(teaOriginPoints([])).toEqual([]);
  });

  it("全銘柄を渡すと 11 点 (仕入先 12 件のうち五ヶ瀬町の 2 件が同一座標で畳まれる)", () => {
    const points = teaOriginPoints(TEA_MENU_NUMBERS);
    expect(points).toHaveLength(11);
    // 畳んだあとも 9 県すべてが残る
    expect(new Set(points.map((p) => p.prefecture)).size).toBe(9);
  });

  it("返る点は全て日本国内の座標", () => {
    for (const p of teaOriginPoints(TEA_MENU_NUMBERS)) {
      expect(p.lat).toBeGreaterThanOrEqual(24);
      expect(p.lat).toBeLessThanOrEqual(46);
      expect(p.lng).toBeGreaterThanOrEqual(122);
      expect(p.lng).toBeLessThanOrEqual(154);
    }
  });
});

describe("座標の正本 (Notion Supplier List の Place)", () => {
  /**
   * 座標が 2 系統 (Notion `Place` / 国土地理院) に分かれていた二重管理を
   * 2026-08-12 に解消し、正本を Notion に統一した。旧 GSI 値へ黙って戻るのを
   * 防ぐため、判断が割れた 2 軒だけ実値で固定する。
   */
  it("hasama は正本 (Notion) の値を採る — GSI 値へ戻さない", () => {
    // 51301 = ハサマ共同製茶組合。両系統とも「三重県四日市市川島町」に解決するが
    // 代表点の取り方が 1.3km 違う。単一正本の原則どおり Notion を採用している。
    const { lat, lng } = resolveTeaOrigin("51301");
    expect({ lat, lng }).toEqual({ lat: 34.97434, lng: 136.56266 });
    // 旧 GSI 値 (34.968712, 136.549942) に戻っていないこと
    expect(lat).not.toBe(34.968712);
  });

  it("tsushima-oishi だけは GSI を残す — 対馬市の重心へ丸めない", () => {
    // 51001 = つしま大石農園。Notion の Place は対馬市全体の重心 (34.20277) で、
    // 南北 80km の島の南部を指し産地から約 45km 外れるため採用しない。
    const { lat, lng } = resolveTeaOrigin("51001");
    expect({ lat, lng }).toEqual({ lat: 34.566456, lng: 129.333176 });
    expect(lat).not.toBe(34.20277);
    // 島の北部 (上県町) 側にあること
    expect(lat).toBeGreaterThan(34.4);
  });

  it("正本統一後も同一町の 2 軒は同一座標のまま (地図で 1 点に畳まれる)", () => {
    // 40301 = 宮崎茶房 / 10401 = 緑碧茶園 五ヶ瀬茶園。どちらも五ヶ瀬町。
    const a = resolveTeaOrigin("10401");
    const b = resolveTeaOrigin("40301");
    expect({ lat: a.lat, lng: a.lng }).toEqual({ lat: b.lat, lng: b.lng });
    expect(teaOriginPoints(["10401", "40301"])).toHaveLength(1);
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
