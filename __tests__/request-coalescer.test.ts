/**
 * 応答の本体を受け取れる一次操作のテスト (`lib/interaction/request-coalescer.ts`)。
 *
 * **実体をそのまま読む** (写しは実体と一緒にずれるので置かない)。
 *
 * このファイルが縛るのは 1 点だけ — **連打・再入で受付を閉じないこと**。
 *
 * 元の実害がそれだった。カートの数量は押した瞬間に動いていた (本番実測
 * 16〜30ms) のに、ボタンが約 2 秒 `disabled` で、250ms 間隔の 2 回目が
 * **黙って捨てられていた**。速さではなく受付を閉じていたのが問題だったので、
 * 新しい一次操作でも、守るのはそこそのものにする。
 *
 *   1. 往復の最中に押されても**弾かない** (`failed` を返さない)
 *   2. 相乗りした呼び出し元にも**同じ応答が返る** (先に押した人だけが得をしない)
 *   3. それでも**往復は 1 本**のまま (券が 2 枚出ない)
 *   4. 決着したら鍵を捨て、次の押下は**新しい往復**になる (使い切りの券を配り回さない)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createRequestCoalescer } from "@/lib/interaction/request-coalescer";
import { logger } from "@/lib/log";

/** 手で解決できる Promise。往復の重なり方を組み立てるために使う。 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createRequestCoalescer — 応答の本体が返る", () => {
  it("1 回だけの操作は、待たせずに 1 本送って中身を返す", async () => {
    const coalescer = createRequestCoalescer<void, { token: string }>({ operation: "test.one" });
    const send = vi.fn().mockResolvedValue({ token: "abc" });

    await expect(coalescer.run("k", undefined, send)).resolves.toEqual({
      status: "ok",
      data: { token: "abc" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("失敗は棄却ではなく結末として返る (相乗り全員に同じものを配れる形)", async () => {
    const coalescer = createRequestCoalescer<void, string>({ operation: "test.fail" });
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const boom = new Error("窓口が落ちた");

    const outcome = await coalescer.run("k", undefined, () => Promise.reject(boom));
    expect(outcome).toEqual({ status: "failed", error: boom });
  });
});

describe("連打・再入で受付を閉じない (このファイルの本題)", () => {
  it("往復の最中に押しても弾かれない — 2 回目も同じ応答を受け取る", async () => {
    const coalescer = createRequestCoalescer<void, { token: string }>({ operation: "test.join" });
    const gate = deferred<{ token: string }>();
    const send = vi.fn().mockReturnValue(gate.promise);

    const first = coalescer.run("k", undefined, send);
    /* 往復が飛んでいる最中に、もう一度押される。 */
    const second = coalescer.run("k", undefined, send);
    const third = coalescer.run("k", undefined, send);

    gate.resolve({ token: "abc" });
    const outcomes = await Promise.all([first, second, third]);

    /* (1) 1 件も捨てられていない = 全員が結末を受け取る。 */
    expect(outcomes).toHaveLength(3);
    /* (2) 2 回目以降が `failed` にならない = 受付を閉じていない。
           ここが `usePessimisticMutation` (二重送信を弾く) との決定的な違い。 */
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ status: "ok", data: { token: "abc" } });
    }
    /* (3) それでも往復は 1 本 (券が 3 枚出ない)。 */
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("落ちたときも、相乗りした全員が同じ失敗を受け取る (黙って消えない)", async () => {
    const coalescer = createRequestCoalescer<void, string>({ operation: "test.join-fail" });
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const gate = deferred<string>();
    const send = vi.fn().mockReturnValue(gate.promise);
    const boom = new Error("窓口が落ちた");

    const waiting = [
      coalescer.run("k", undefined, send),
      coalescer.run("k", undefined, send),
      coalescer.run("k", undefined, send),
    ];
    gate.reject(boom);
    const outcomes = await Promise.all(waiting);

    for (const outcome of outcomes) expect(outcome).toEqual({ status: "failed", error: boom });
    /* 記録は 1 回だけ。同じ失敗を人数ぶん数えると、件数で異常に気づけなくなる。 */
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("20 連打しても 1 件も捨てられず、往復は 1 本のまま", async () => {
    /* 「250ms 間隔の 2 回目が黙って捨てられていた」の再発を、回数で縛る。 */
    const coalescer = createRequestCoalescer<void, number>({ operation: "test.burst" });
    const gate = deferred<number>();
    const send = vi.fn().mockReturnValue(gate.promise);

    const pressed = Array.from({ length: 20 }, () => coalescer.run("k", undefined, send));
    gate.resolve(7);
    const outcomes = await Promise.all(pressed);

    expect(outcomes.filter((o) => o.status === "ok")).toHaveLength(20);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("決着したら鍵を捨てる — 次に押されたら新しい往復になる", async () => {
    /* 入場券は使い切り。決着済みの応答を配り続けると、期限切れを掴ませる。 */
    const coalescer = createRequestCoalescer<void, string>({ operation: "test.fresh" });
    const send = vi
      .fn()
      .mockResolvedValueOnce("1 枚目")
      .mockResolvedValueOnce("2 枚目");

    await expect(coalescer.run("k", undefined, send)).resolves.toEqual({
      status: "ok",
      data: "1 枚目",
    });
    await expect(coalescer.run("k", undefined, send)).resolves.toEqual({
      status: "ok",
      data: "2 枚目",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("失敗のあとも閉じたままにしない — 押し直せば新しい往復が飛ぶ", async () => {
    const coalescer = createRequestCoalescer<void, string>({ operation: "test.retry" });
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("一度落ちた"))
      .mockResolvedValueOnce("取れた");

    expect((await coalescer.run("k", undefined, send)).status).toBe("failed");
    await expect(coalescer.run("k", undefined, send)).resolves.toEqual({
      status: "ok",
      data: "取れた",
    });
  });

  it("相手が違えば相乗りしない (別の鍵は別の往復)", async () => {
    const coalescer = createRequestCoalescer<string, string>({ operation: "test.keys" });
    const send = vi.fn().mockImplementation(async (input: string) => `${input}!`);

    const [a, b] = await Promise.all([
      coalescer.run("a", "a", send),
      coalescer.run("b", "b", send),
    ]);
    expect(a).toEqual({ status: "ok", data: "a!" });
    expect(b).toEqual({ status: "ok", data: "b!" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("isBusy は往復の最中だけ true (進行の印のためにある)", async () => {
    const coalescer = createRequestCoalescer<void, string>({ operation: "test.busy" });
    const gate = deferred<string>();

    expect(coalescer.isBusy("k")).toBe(false);
    const running = coalescer.run("k", undefined, () => gate.promise);
    expect(coalescer.isBusy("k")).toBe(true);

    gate.resolve("ok");
    await running;
    expect(coalescer.isBusy("k")).toBe(false);
  });
});
