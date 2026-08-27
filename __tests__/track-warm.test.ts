/**
 * 曲を押される前に温める仕組みを縛る (網羅表 2026-08-27 / G8)。
 *
 * ## 直している症状
 *
 * 曲行を押すと `<audio>` の `src` が差し替わり、**そこで初めて**その音源を
 * 取りにいく。鳴り始めるまで行は `loading` のまま止まる。
 *
 * ここで縛る契約:
 *   1. 温めるのは音源の**先頭だけ** (`preload="metadata"`)。`auto` にすると
 *      押されるか分からない曲を丸ごと落とすことになる。
 *   2. 同じ曲を二度取りにいかない (マウスが行の上を何度通っても 1 回)。
 *   3. 通信量を惜しむ設定 (データセーバー) のときは何もしない。
 *   4. 取りかけの要素は数本だけ抱える。抱えっぱなしにも、すぐ捨てるにも
 *      しない (捨てると取得ごと回収されて温まらない)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { warmTrack, __resetTrackWarmForTest } from "@/components/audio/track-warm";

type FakeAudio = { preload: string; src: string; loaded: number };

const created: FakeAudio[] = [];

/**
 * `new Audio()` と `navigator` を差し替える。
 *
 * Node 22 は `navigator` を**自前で持っている**ので、素の `delete` で消すと
 * 後片付けのつもりが環境を壊す。元の定義を取っておいて必ず戻す。
 */
const ORIGINAL: Record<string, PropertyDescriptor | undefined> = {
  Audio: Object.getOwnPropertyDescriptor(globalThis, "Audio"),
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
};

function define(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

function installBrowser(options: { saveData?: boolean } = {}) {
  created.length = 0;

  class StubAudio {
    preload = "";
    src = "";
    loaded = 0;
    constructor() {
      created.push(this as unknown as FakeAudio);
    }
    load() {
      this.loaded += 1;
    }
  }

  define("Audio", StubAudio);
  define(
    "navigator",
    options.saveData === undefined ? {} : { connection: { saveData: options.saveData } },
  );
}

function uninstallBrowser() {
  for (const key of Object.keys(ORIGINAL)) {
    const descriptor = ORIGINAL[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
}

beforeEach(() => {
  __resetTrackWarmForTest();
});

afterEach(() => {
  uninstallBrowser();
  __resetTrackWarmForTest();
});

describe("温める", () => {
  it("音源の先頭だけを取りにいく (曲を丸ごと落とさない)", () => {
    installBrowser();
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(true);

    expect(created).toHaveLength(1);
    expect(created[0].preload).toBe("metadata");
    expect(created[0].src).toBe("https://cdn.test/a.mp3");
    expect(created[0].loaded).toBe(1);
  });

  it("同じ曲は二度取りにいかない", () => {
    installBrowser();
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(true);
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(false);
    expect(created).toHaveLength(1);
  });

  it("別の曲は別に温める", () => {
    installBrowser();
    warmTrack("https://cdn.test/a.mp3");
    warmTrack("https://cdn.test/b.mp3");
    expect(created).toHaveLength(2);
  });

  it("空の src では何もしない", () => {
    installBrowser();
    expect(warmTrack("")).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe("温めない条件", () => {
  it("通信量を惜しむ設定のときは 1 本も取りにいかない", () => {
    installBrowser({ saveData: true });
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("saveData が分からないブラウザでは温める (未対応を『惜しむ』と読まない)", () => {
    installBrowser({ saveData: false });
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(true);
  });

  it("ブラウザではない場所 (サーバ) では何もしない", () => {
    /* installBrowser を呼ばない = Audio も navigator も無い状態。 */
    expect(warmTrack("https://cdn.test/a.mp3")).toBe(false);
  });
});

describe("取りかけの抱え方", () => {
  it("古いものは取得を止めてから手放す (押されなかった曲で回線を握らない)", () => {
    installBrowser();
    /* 上限は 3 本。4 本目を入れると 1 本目が押し出される。 */
    for (const name of ["a", "b", "c", "d"]) warmTrack(`https://cdn.test/${name}.mp3`);

    expect(created).toHaveLength(4);
    expect(created[0].src, "押し出された 1 本目の取得が止まっていない").toBe("");
    expect(created[3].src).toBe("https://cdn.test/d.mp3");
  });
});
