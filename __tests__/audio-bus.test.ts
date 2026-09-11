/**
 * 音の交通整理 (`lib/audio/audio-bus.ts`) の回帰テスト。
 *
 * このモジュールは「サイト内で同時に鳴らせる音は 1 つ」を決める唯一の場所で、
 * 実際の購読者は `components/audio/article-audio-provider.tsx` 1 本だけである。
 * 音声会話を 3 人目の参加者として足すにあたり、放送の中身を「誰が」から
 * 「誰が・始まりか終わりか」へ広げた。その拡張が **既存の購読者を壊していない**
 * ことを機械的に縛るのがこのテストの目的。
 *
 * 守りたい不変条件は 3 つ:
 *  1. 既存 2 関数 (`announceAudioPlay` / `subscribeAudioPlay`) の形と意味が
 *     変わっていない (引数の数・listener が受け取る引数・購読解除の戻り値)。
 *     ここが落ちたら `article-audio-provider.tsx` の無改修という前提が崩れる。
 *  2. 「始まり」の放送で自分以外が止まる (排他の本体)。
 *  3. 「終わり」の放送が届く (これが無いと音声のあと BGM が戻らない)。
 */
import { describe, it, expect, vi } from "vitest";

import {
  announceAudioPhase,
  announceAudioPlay,
  announceAudioRelease,
  subscribeAudioPhase,
  subscribeAudioPlay,
  type AudioOwner,
} from "@/lib/audio/audio-bus";

describe("音の交通整理 — 既存 2 関数の互換", () => {
  it("announceAudioPlay は引数 1 つ / subscribeAudioPlay も引数 1 つ (形が変わっていない)", () => {
    // 引数の数が増えると、既存の呼び出し元 (`announceAudioPlay('article')`) が
    // 「足りない引数」で型エラーになる。拡張は必ず別関数で行うこと。
    expect(announceAudioPlay.length).toBe(1);
    expect(subscribeAudioPlay.length).toBe(1);
  });

  it("subscribeAudioPlay の listener は owner だけを受け取る (phase を混ぜない)", () => {
    const seen: unknown[][] = [];
    const unsubscribe = subscribeAudioPlay((...args: unknown[]) => {
      seen.push(args);
    });

    announceAudioPlay("article");
    unsubscribe();

    expect(seen).toHaveLength(1);
    // 第 2 引数に phase が漏れると、owner だけを見る既存実装の分岐が変わりうる。
    expect(seen[0]).toEqual(["article"]);
  });

  it("subscribeAudioPlay の戻り値を呼ぶと購読が解除される", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioPlay(listener);

    announceAudioPlay("bgm");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    announceAudioPlay("bgm");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("既存の購読者は「終わり」の放送を受け取らない (始まりだけを通す薄い包み)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioPlay(listener);

    announceAudioRelease("voice");
    expect(listener).not.toHaveBeenCalled();

    announceAudioPlay("voice");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("音の交通整理 — 排他 (始まりの放送)", () => {
  it("誰かが鳴り始めたら、自分以外の参加者は自分を止める", () => {
    // 実際の provider の形 (自分が owner でなければ止める) を写した最小の模型。
    const stopped: AudioOwner[] = [];
    const makeParticipant = (self: AudioOwner) =>
      subscribeAudioPlay((owner) => {
        if (owner !== self) stopped.push(self);
      });

    const unsubscribers = [
      makeParticipant("bgm"),
      makeParticipant("article"),
      makeParticipant("voice"),
    ];

    announceAudioPlay("voice");

    expect(stopped).toEqual(["bgm", "article"]);
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("音声会話が参加者として存在する (3 人目を足した拡張)", () => {
    const seen: AudioOwner[] = [];
    const unsubscribe = subscribeAudioPlay((owner) => seen.push(owner));

    announceAudioPlay("voice");
    unsubscribe();

    expect(seen).toEqual(["voice"]);
  });
});

describe("音の交通整理 — 解放 (終わりの放送)", () => {
  it("終わりの放送が phase 付きで届く", () => {
    const seen: Array<[AudioOwner, string]> = [];
    const unsubscribe = subscribeAudioPhase((owner, phase) => seen.push([owner, phase]));

    announceAudioPlay("voice");
    announceAudioRelease("voice");
    unsubscribe();

    expect(seen).toEqual([
      ["voice", "start"],
      ["voice", "release"],
    ]);
  });

  it("将来 BGM が載ったとき、終わりを見て自分を再開できる", () => {
    // BGM 側が書くであろう配線をそのまま模型にしてある。音声側の配線は 0 行。
    let bgmPlaying = true;
    const unsubscribe = subscribeAudioPhase((owner, phase) => {
      if (owner === "bgm") return;
      if (phase === "start") bgmPlaying = false;
      if (phase === "release") bgmPlaying = true;
    });

    announceAudioPlay("voice");
    expect(bgmPlaying).toBe(false);

    announceAudioRelease("voice");
    expect(bgmPlaying).toBe(true);

    unsubscribe();
  });

  it("announceAudioPhase は announceAudioPlay / announceAudioRelease と同じ放送をする", () => {
    const seen: Array<[AudioOwner, string]> = [];
    const unsubscribe = subscribeAudioPhase((owner, phase) => seen.push([owner, phase]));

    announceAudioPhase("article", "start");
    announceAudioPhase("article", "release");
    unsubscribe();

    expect(seen).toEqual([
      ["article", "start"],
      ["article", "release"],
    ]);
  });

  it("放送の最中に購読解除が起きても残りの購読者に届く", () => {
    const seen: string[] = [];
    const unsubscribeSelf = subscribeAudioPhase(() => {
      seen.push("first");
      unsubscribeSelf();
    });
    const unsubscribeSecond = subscribeAudioPhase(() => seen.push("second"));

    announceAudioPlay("voice");
    unsubscribeSecond();

    expect(seen).toEqual(["first", "second"]);
  });
});
