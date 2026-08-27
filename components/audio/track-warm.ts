"use client";

import { mayPrefetchMedia } from "@/components/media/prefetch-policy";

/**
 * 曲を**押される前に**温めておく (網羅表 2026-08-27 / G8)。
 *
 * ## 直している症状
 *
 * 曲行を押すと `article-audio-provider` が 1 つしか無い `<audio>` の `src` を
 * 差し替える。差し替えた瞬間に**その音源を初めて取りにいく**ので、鳴り始める
 * までのあいだ行は `loading` のまま止まる。進行の印があるぶん写真より軽症だが、
 * 原因は写真の切替 (#169) とまったく同じ「押されてから初めて取っている」。
 *
 * ## 何をするか
 *
 * `preload="metadata"` の使い捨て `<audio>` を作って `load()` を呼ぶ。ブラウザは
 * 音源の先頭だけを取って HTTP キャッシュに置くので、あとで本物の `<audio>` が
 * 同じ URL を要求したときはそこから始められる。**曲を丸ごと落とすのではない**
 * (`metadata` は先頭の数十 KB で、`auto` にすると全曲ぶん落ちてしまう)。
 *
 * 温めた URL は覚えておき、同じ曲を二度取りにいかない。通信量を惜しむ設定の
 * ときは何もしない (判断は `components/media/prefetch-policy` が正本)。
 */

/** 既に温めた音源。タブに 1 つ。 */
const warmed = new Set<string>();

/**
 * 取りかけの `<audio>` の置き場。
 *
 * `load()` を呼んだだけの要素はどこからも参照されないので、取り終わる前に
 * 回収されて**取得ごと捨てられる**ことがある。直近の数本だけ参照を残す。
 * 上限があるのは、これ自体が漏れ (leak) にならないようにするため。
 */
const inFlight: HTMLAudioElement[] = [];
const IN_FLIGHT_MAX = 3;

/**
 * 1 曲を温める。**実際に取りにいったときだけ `true`** を返す
 * (既に温めてある / 先読みしない設定 / ブラウザではない、のときは `false`)。
 */
export function warmTrack(src: string): boolean {
  if (!src) return false;
  if (warmed.has(src)) return false;
  if (!mayPrefetchMedia()) return false;
  if (typeof Audio === "undefined") return false;

  warmed.add(src);

  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = src;
  probe.load();

  inFlight.push(probe);
  while (inFlight.length > IN_FLIGHT_MAX) {
    const oldest = inFlight.shift();
    /* 参照を手放す前に取得も止める。押されなかった曲のために回線を
       握り続けない。 */
    if (oldest) oldest.src = "";
  }

  return true;
}

/** テスト用。タブに 1 つの記憶を空にする。 */
export function __resetTrackWarmForTest(): void {
  warmed.clear();
  inFlight.length = 0;
}
