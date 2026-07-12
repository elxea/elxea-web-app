import { describe, it, expect } from "vitest";

import {
  measure,
  isWrapper,
  isUndecorated,
} from "@/scripts/design-system/figma-ds-instance-rate";

/**
 * wrapper 除外ルールの fixture 単体テスト。
 *
 * ルール (監査提案 / Boss 承認済 2026-07-13):
 *   INSTANCE を直下に内包する無装飾 (fill/stroke/effect なし) の FRAME/GROUP は
 *   素描き母集団 (total = 分母) から除外し、件数を wrapper_excluded に別掲する。
 *   除外しても子孫 (内包 INSTANCE 等) には通常どおり降下する。
 *
 * Figma token が .env.local 未設定のため実 API は叩かず、node ツリーの fixture で
 * measure() の決定論を検証する (real API run は token 設定後に detector が実行)。
 */

type N = {
  id: string;
  name: string;
  type: string;
  children?: N[];
  fills?: Array<{ visible?: boolean }>;
  strokes?: Array<{ visible?: boolean }>;
  effects?: Array<{ visible?: boolean }>;
};

const instance = (id: string): N => ({ id, name: id, type: "INSTANCE" });
const solidFill = [{ visible: true }];

describe("figma-ds-instance-rate: wrapper 除外ルール", () => {
  it("baseline: INSTANCE と非 INSTANCE ノードを従来どおり数える", () => {
    // section > [ TEXT, INSTANCE ]  (TEXT は装飾 FRAME ではないので wrapper ではない)
    const section: N = {
      id: "s",
      name: "@baseline",
      type: "SECTION",
      children: [
        { id: "t", name: "title", type: "TEXT" },
        instance("btn"),
      ],
    };
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 2,
      wrapper_excluded: 0,
    });
  });

  it("無装飾 FRAME が INSTANCE を直下に内包する → wrapper として total から除外", () => {
    // section > wrapperFrame(無装飾) > INSTANCE
    const section: N = {
      id: "s",
      name: "@wrap",
      type: "SECTION",
      children: [
        {
          id: "w",
          name: "wrapper",
          type: "FRAME",
          fills: [],
          strokes: [],
          effects: [],
          children: [instance("btn")],
        },
      ],
    };
    // wrapper は total に数えない (0) が、内包 INSTANCE は降下して 1 カウント
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 1,
      wrapper_excluded: 1,
    });
  });

  it("装飾あり FRAME (可視 fill) が INSTANCE を内包 → wrapper ではない (total に残る)", () => {
    const section: N = {
      id: "s",
      name: "@decorated",
      type: "SECTION",
      children: [
        {
          id: "card",
          name: "card",
          type: "FRAME",
          fills: solidFill,
          children: [instance("btn")],
        },
      ],
    };
    // card は装飾ありなので分母に残る (1) + INSTANCE (1) = total 2
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 2,
      wrapper_excluded: 0,
    });
  });

  it("GROUP は純コンテナ (無装飾) → INSTANCE 内包で wrapper 除外", () => {
    const section: N = {
      id: "s",
      name: "@group",
      type: "SECTION",
      children: [
        {
          id: "g",
          name: "group",
          type: "GROUP",
          children: [instance("a"), instance("b")],
        },
      ],
    };
    expect(measure(section as never)).toEqual({
      instances: 2,
      total: 2,
      wrapper_excluded: 1,
    });
  });

  it("無装飾 FRAME だが直下に INSTANCE を持たない → wrapper ではない", () => {
    // 直下は TEXT のみ。孫に INSTANCE があっても直下条件を満たさない。
    const section: N = {
      id: "s",
      name: "@no-direct-instance",
      type: "SECTION",
      children: [
        {
          id: "f",
          name: "frame",
          type: "FRAME",
          fills: [],
          children: [
            {
              id: "inner",
              name: "inner",
              type: "TEXT",
              children: [instance("deep")],
            },
          ],
        },
      ],
    };
    // frame(1) + inner TEXT(1) + INSTANCE(1) = total 3、除外なし
    expect(measure(section as never)).toEqual({
      instances: 1,
      total: 3,
      wrapper_excluded: 0,
    });
  });

  it("invisible な fill のみ持つ FRAME は無装飾扱い", () => {
    expect(
      isUndecorated({
        id: "x",
        name: "x",
        type: "FRAME",
        fills: [{ visible: false }] as never,
      } as never)
    ).toBe(true);
    expect(
      isWrapper({
        id: "x",
        name: "x",
        type: "FRAME",
        fills: [{ visible: false }] as never,
        children: [instance("i") as never],
      } as never)
    ).toBe(true);
  });
});
