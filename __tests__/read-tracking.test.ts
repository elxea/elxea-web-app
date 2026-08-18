import { describe, it, expect } from "vitest";

import {
  READ_VISIBLE_MS,
  createVisibleTimer,
  scrollReadState,
} from "@/lib/journal/read-tracking";

/** 手で進められる時刻源。 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("createVisibleTimer", () => {
  it("可視のあいだだけ時間を積算する", () => {
    const clock = fakeClock();
    const timer = createVisibleTimer(clock.now);

    timer.resume();
    clock.advance(10_000);
    expect(timer.elapsedMs()).toBe(10_000);

    // バックグラウンドに回った 60 秒は数えない。
    timer.pause();
    clock.advance(60_000);
    expect(timer.elapsedMs()).toBe(10_000);

    timer.resume();
    clock.advance(5_000);
    expect(timer.elapsedMs()).toBe(15_000);
  });

  it("不可視のあいだは残り時間を返さない (タイマーを張らせない)", () => {
    const clock = fakeClock();
    const timer = createVisibleTimer(clock.now);

    expect(timer.remainingMs()).toBeNull();

    timer.resume();
    clock.advance(10_000);
    expect(timer.remainingMs()).toBe(READ_VISIBLE_MS - 10_000);

    timer.pause();
    expect(timer.remainingMs()).toBeNull();
  });

  it("resume を重ねても二重に計上しない", () => {
    const clock = fakeClock();
    const timer = createVisibleTimer(clock.now);

    timer.resume();
    clock.advance(1_000);
    timer.resume();
    clock.advance(1_000);

    expect(timer.elapsedMs()).toBe(2_000);
  });

  it("しきい値を超えたら残りは 0 で止まる", () => {
    const clock = fakeClock();
    const timer = createVisibleTimer(clock.now);

    timer.resume();
    clock.advance(READ_VISIBLE_MS + 5_000);

    expect(timer.remainingMs()).toBe(0);
  });
});

describe("scrollReadState", () => {
  it("8 割まで到達したら読了", () => {
    // scrollHeight 2000 / innerHeight 1000 → docHeight 1000。800 で 80%。
    expect(scrollReadState(800, 2000, 1000)).toBe("read");
    expect(scrollReadState(1000, 2000, 1000)).toBe("read");
  });

  it("8 割未満は読了にしない", () => {
    expect(scrollReadState(799, 2000, 1000)).toBe("reading");
    expect(scrollReadState(0, 2000, 1000)).toBe("reading");
  });

  it("1 画面に収まる記事はスクロールでは判定できない", () => {
    // 短記事: scrollHeight <= innerHeight。従来はここで読了が永久に立たなかった。
    expect(scrollReadState(0, 800, 1000)).toBe("undecidable");
    expect(scrollReadState(0, 1000, 1000)).toBe("undecidable");
  });
});
