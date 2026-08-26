/**
 * チャットの入口が「読んでいるあいだは引っ込む」判断を縛る (監査 #17)。
 *
 * SP390 の商品一覧で、固定のチャット入口が 2 行目カードのタイトル文字に重なって
 * いた。固定要素と流れてくる本文の重なりは、余白でも z でも解けない
 * (`hooks/use-retreat-on-scroll.ts` の但し書き)。時間軸で避けるほかない。
 *
 * ここで縛るのは判断の中身だけ (`retreatOnScroll` は純関数)。実際に
 * `transform` / `opacity` が切り替わることは story 側の担当。
 */
import { describe, it, expect } from "vitest";

import {
  RETREAT_THRESHOLD_PX,
  initialRetreatState,
  retreatOnScroll,
} from "@/hooks/use-retreat-on-scroll";

/** 位置の並びを順に流し込み、最後の状態を返す。 */
function scrollThrough(positions: readonly number[], startY = positions[0] ?? 0) {
  let state = initialRetreatState(startY);
  for (const y of positions) state = retreatOnScroll(state, y);
  return state;
}

describe("読んでいるあいだは引っ込む", () => {
  it("下へ十分に動いたら引っ込む", () => {
    const state = scrollThrough([0, 100, 400], 0);
    expect(state.visible).toBe(false);
  });

  it("指の震え程度 (閾値以下) では消えない", () => {
    const state = scrollThrough([100, 100 + RETREAT_THRESHOLD_PX], 100);
    expect(state.visible).toBe(true);
  });
});

describe("探した瞬間に戻る", () => {
  it("上へ動いたら即座に出す", () => {
    const hidden = scrollThrough([0, 400], 0);
    expect(hidden.visible).toBe(false);

    /* 1px でも上へ戻ったら出す。「戻したのにまだ隠れている」を作らない。 */
    expect(retreatOnScroll(hidden, 399).visible).toBe(true);
  });

  it("一度戻ってから、また下へ動けばもう一度引っ込む", () => {
    /* 閾値を **向きが変わった地点からの移動量** で測っていることの確認。
       絶対座標で測る実装だと、ここは隠れないまま通ってしまう。 */
    const state = scrollThrough([0, 400, 380, 380 + RETREAT_THRESHOLD_PX + 1], 0);
    expect(state.visible).toBe(false);
  });

  it("長い一覧を下り続けても、途中で上へ戻れば必ず出る", () => {
    const state = scrollThrough([0, 500, 1200, 3000, 2900], 0);
    expect(state.visible).toBe(true);
  });
});

describe("画面最上部では隠さない", () => {
  it("先頭に戻ったら出す", () => {
    const hidden = scrollThrough([0, 400], 0);
    expect(retreatOnScroll(hidden, 0).visible).toBe(true);
  });

  it("慣性で負の位置へ振れても出したまま", () => {
    const hidden = scrollThrough([0, 400], 0);
    expect(retreatOnScroll(hidden, -30).visible).toBe(true);
  });
});
