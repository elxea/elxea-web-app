/**
 * 連打を捌く共通の交通整理のテスト。
 *
 * **実体をそのまま読む** (`lib/interaction/write-queue.ts`)。写しは実体と一緒に
 * ずれるので置かない (Wave A の `cart-reducer` と同じ方針)。
 *
 * 守りたいのは 3 つ。
 *   1. 1 つの相手につき往復は 1 本ずつしか飛ばない (到着順が入れ替わらない)
 *   2. 絶対量 (`"latest"`) は途中を間引き、**最後に送る値は必ず最新**
 *   3. 加算 (`"all"`) は**間引かない** — 押した回数がそのまま送られる
 */
import { describe, it, expect, vi } from "vitest";
import { createWriteQueue } from "@/lib/interaction/write-queue";

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

describe("createWriteQueue — 共通の規則", () => {
  it("1 回だけの操作は、待たせずにそのまま 1 本送る", async () => {
    const queue = createWriteQueue<number>();
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(queue.enqueue("line-1", 2, send)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(2);
  });

  it("同時に 2 本飛ばさない (到着順の入れ替わりが起きない)", async () => {
    const queue = createWriteQueue<number>();
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await Promise.all([
      queue.enqueue("line-1", 2, send),
      queue.enqueue("line-1", 3, send),
      queue.enqueue("line-1", 4, send),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("相手が違えば互いに待たない", async () => {
    const queue = createWriteQueue<number>();
    const blocked = deferred();
    const sendA = vi.fn().mockReturnValue(blocked.promise);
    const sendB = vi.fn().mockResolvedValue(undefined);

    const a = queue.enqueue("line-1", 2, sendA);
    await expect(queue.enqueue("line-2", 9, sendB)).resolves.toBe("ok");
    expect(sendB).toHaveBeenCalledWith(9);

    blocked.resolve(undefined);
    await a;
  });

  it("失敗したら failed を返し、待たせていた分を追い撃ちしない", async () => {
    const queue = createWriteQueue<number>();
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const a = queue.enqueue("line-1", 2, send);
    const b = queue.enqueue("line-1", 3, send);

    first.reject(new Error("network down"));

    expect(await Promise.all([a, b])).toEqual(["failed", "failed"]);
    /* 実体がどうなったか分からない状態で 3 を送り直さない。 */
    expect(send).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("失敗のあとも同じ相手をもう一度使える (列が詰まらない)", async () => {
    const queue = createWriteQueue<number>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      queue.enqueue("line-1", 2, vi.fn().mockRejectedValue(new Error("nope"))),
    ).resolves.toBe("failed");
    expect(queue.isBusy("line-1")).toBe(false);

    const ok = vi.fn().mockResolvedValue(undefined);
    await expect(queue.enqueue("line-1", 3, ok)).resolves.toBe("ok");
    expect(ok).toHaveBeenCalledWith(3);
    errorSpy.mockRestore();
  });
});

describe('"latest" — 絶対量 (数量・保存済みなど)', () => {
  it("往復中に押された分は、着いてから**最後の 1 つだけ**送り直す", async () => {
    const queue = createWriteQueue<number>();
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);

    /* 1 本目が飛んだまま、3 回続けて押す (2 → 3 → 4 → 5)。 */
    const all = [
      queue.enqueue("line-1", 2, send),
      queue.enqueue("line-1", 3, send),
      queue.enqueue("line-1", 4, send),
      queue.enqueue("line-1", 5, send),
    ];

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, 2);

    first.resolve();
    expect(await Promise.all(all)).toEqual(["ok", "ok", "ok", "ok"]);

    /* 往復は 2 本で済み、2 本目は**最新の 5**。3 と 4 は間引かれる
       (絶対量なので、間引いても最終結果は変わらない)。 */
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 5);
  });

  it("往復中に元の値へ戻ったら、無駄な 2 本目を送らない", async () => {
    const queue = createWriteQueue<number>();
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);

    /* + と − を 1 回ずつ押すと、最後にほしい値は最初と同じ 2 に戻る。 */
    const all = [
      queue.enqueue("line-1", 2, send),
      queue.enqueue("line-1", 3, send),
      queue.enqueue("line-1", 2, send),
    ];

    first.resolve();
    await Promise.all(all);

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('"all" — 加算 (カートに追加など)', () => {
  it("連打した回数だけ、間引かずに順番に送る", async () => {
    const queue = createWriteQueue<string>();
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);

    /* 同じ商品を 3 回続けて押す。**同じ値だが回数に意味がある**。 */
    const all = [
      queue.enqueue("add:v1", "v1", send, "all"),
      queue.enqueue("add:v1", "v1", send, "all"),
      queue.enqueue("add:v1", "v1", send, "all"),
    ];

    expect(send).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all(all);

    /* 3 回押したら 3 回送られる。ここを間引くと「3 回押したのに 1 個しか
       入らない」という取りこぼしになる。 */
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("順番どおりに送る (追い越さない)", async () => {
    const queue = createWriteQueue<number>();
    const order: number[] = [];
    const gate = deferred();
    let firstCall = true;
    const send = vi.fn().mockImplementation(async (payload: number) => {
      order.push(payload);
      if (firstCall) {
        firstCall = false;
        await gate.promise;
      }
    });

    const all = [
      queue.enqueue("k", 1, send, "all"),
      queue.enqueue("k", 2, send, "all"),
      queue.enqueue("k", 3, send, "all"),
    ];
    gate.resolve();
    await Promise.all(all);

    expect(order).toEqual([1, 2, 3]);
  });
});
