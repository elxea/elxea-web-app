/**
 * 同じ相手への連打を捌く交通整理。**サイト共通の 1 本**。
 *
 * `use-optimistic-action` の下請けで、画面のことは何も知らない (React にも
 * 依存しない) ので、単体で組み立てて確かめられる。
 *
 * ## なぜ要るか
 *
 * 「押した瞬間に画面を書き換え、送信は待たせない」を素直に書くと、連打したぶん
 * だけ往復が同時に飛ぶ。**到着順が入れ替わると、最後にサーバへ残る値が画面と
 * 食い違う**。たとえば数量を 5 連打して 6 にしたのに、遅れて届いた 4 が最後に
 * 効いてしまう。画面は 6 を出したあとサーバの 4 に引き戻されるので、数字が
 * 勝手に減って見える。
 *
 * ここが引き受けるのは「1 つの相手 (`key`) につき同時に 1 本しか飛ばさない」
 * という 1 点だけ。遅延はいっさい足さない (1 回だけの操作は即座に 1 本送る)。
 *
 * ## 2 つの捌き方 — 送る値の性質で選ぶ
 *
 * | mode | 送る値 | 連打したとき | 例 |
 * |---|---|---|---|
 * | `"latest"` (既定) | **絶対量** (それ単体で結果が決まる) | 途中を間引き、**最後の 1 つだけ**送る | 数量を 5 にする / 保存済みにする |
 * | `"all"` | **加算** (前の状態に足す) | 間引かず、**順番に全部**送る | カートに 1 個足す |
 *
 * 選び違えると壊れる。絶対量に `"all"` を使うと往復が無駄に増えるだけだが、
 * **加算に `"latest"` を使うと回数そのものが消える** — 「カートに追加」を
 * 3 回押したのに 1 個しか入らない、という取りこぼしになる。
 */

export type WriteOutcome = "ok" | "failed";

/** 1 件ぶんの送信。 */
export type SendPayload<TPayload> = (payload: TPayload) => Promise<unknown>;

/**
 * 連打の捌き方。`"latest"` は最後の 1 つだけ、`"all"` は順番に全部。
 * 迷ったら「この値を 2 回続けて送ったら結果が変わるか」で決める
 * (変わるなら加算なので `"all"`)。
 */
export type WriteMode = "latest" | "all";

type QueueEntry<TPayload> = {
  /** いま飛んでいる往復があるか。 */
  inFlight: boolean;
  /** 待たせている申し込み。`"latest"` では常に 0〜1 件。 */
  queued: TPayload[];
  /** この相手の決着を待っている呼び出し元。 */
  waiters: ((outcome: WriteOutcome) => void)[];
};

export type WriteQueue<TPayload> = {
  /**
   * `key` の相手へ `payload` を送りたい、と申し込む。
   *
   * 返る Promise は**その相手の一連の書き込みが落ち着いたとき**に解決する。
   * 連打した場合、途中の申し込みも最後の結果を共有して解決する
   * (楽観更新をいつ畳んでよいかが、これで呼び出し側から分かる)。
   */
  enqueue: (
    key: string,
    payload: TPayload,
    send: SendPayload<TPayload>,
    mode?: WriteMode,
  ) => Promise<WriteOutcome>;
  /** いまその相手へ往復が飛んでいるか。 */
  isBusy: (key: string) => boolean;
};

export function createWriteQueue<TPayload>(options?: {
  /**
   * 値が同じかどうか。`"latest"` で**同じ値を送り直さない**足切りに使う
   * (+ と − を 1 回ずつ押して元に戻ったときなど)。
   */
  isEqual?: (a: TPayload, b: TPayload) => boolean;
}): WriteQueue<TPayload> {
  const isEqual = options?.isEqual ?? ((a: TPayload, b: TPayload) => Object.is(a, b));
  const entries = new Map<string, QueueEntry<TPayload>>();

  function settle(key: string, entry: QueueEntry<TPayload>, outcome: WriteOutcome) {
    const waiters = entry.waiters;
    entry.waiters = [];
    entry.inFlight = false;
    entry.queued = [];
    entries.delete(key);
    for (const resolve of waiters) resolve(outcome);
  }

  async function run(
    key: string,
    payload: TPayload,
    send: SendPayload<TPayload>,
    mode: WriteMode,
  ): Promise<void> {
    const entry = entries.get(key);
    if (!entry) return;
    entry.inFlight = true;
    try {
      await send(payload);
    } catch (e) {
      console.error(`write-queue: send failed for "${key}"`, e);
      /* 失敗したらそこで打ち切る。待たせていた分も送らない — サーバの実体が
         分からない状態で追い撃ちをかけない。呼び出し元は `failed` を受け取り、
         楽観更新はサーバの値へ巻き戻る。 */
      settle(key, entry, "failed");
      return;
    }

    const next = entry.queued.shift();
    if (next !== undefined) {
      /* `"latest"` で値が変わっていなければ送り直さない (無駄な往復を省く)。
         `"all"` は回数そのものに意味があるので、同じ値でも必ず送る。 */
      if (mode === "all" || !isEqual(next, payload)) {
        await run(key, next, send, mode);
        return;
      }
    }
    settle(key, entry, "ok");
  }

  return {
    enqueue(key, payload, send, mode = "latest") {
      let entry = entries.get(key);
      if (!entry) {
        entry = { inFlight: false, queued: [], waiters: [] };
        entries.set(key, entry);
      }
      const settled = new Promise<WriteOutcome>((resolve) => {
        entry!.waiters.push(resolve);
      });

      if (entry.inFlight) {
        if (mode === "latest") {
          /* 最後の 1 つだけ持てばよい。 */
          entry.queued = [payload];
        } else {
          entry.queued.push(payload);
        }
      } else {
        void run(key, payload, send, mode);
      }
      return settled;
    },
    isBusy(key) {
      return entries.get(key)?.inFlight ?? false;
    },
  };
}
