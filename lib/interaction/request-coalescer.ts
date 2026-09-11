/**
 * **応答の本体を受け取れる一次操作。** `lib/interaction` の 4 本目。
 *
 * 既存の 2 本 (`useOptimisticMutation` / `usePessimisticMutation`) は
 * **成否しか返さない** (`WriteOutcome = "ok" | "failed"`)。押した結果が画面の値で
 * 完結する操作 — トグル・数量・フォーム送信 — はそれで足りる。
 *
 * 足りないのは「押した結果として**サーバが渡してくるものを持ち帰る**」操作で、
 * 実例が 2 つある。
 *
 *   1. 音声の入場券 (`POST /api/voice/token`) — `access_token` と
 *      `session_handle` を受け取らないと、その先の接続が始められない
 *   2. 会話のストリーム (`components/chat/elxea-chat-transport.ts`) — SSE の
 *      本体を受け取らないと、返事が 1 文字も出ない
 *
 * どちらも「押した瞬間に効く」の対象**である**のに、成否しか返らない通り道には
 * 載せられなかった。2 の側はそれで例外表 (`ALLOWLIST`) に入っている。
 *
 * **この一次操作はその穴をふさぐためのもので、逃げ道ではない。** ここへ寄せれば
 * `components/chat/elxea-chat-transport.ts` の 1 行は例外表から**外せる**
 * (= `interaction-allowlist` の ratchet を縮小方向に動かせる)。移行そのものは
 * 別タスクだが、この通り道が在ることがその前提になる。
 *
 * ## 何を保証するのか — 「受付を閉じない」「黙って捨てない」
 *
 * 元の実害は速さではなく**受付を閉じていたこと**だった。カートの数量は押した
 * 瞬間に動いていた (本番実測 16〜30ms) のに、ボタンが約 2 秒 `disabled` で、
 * 250ms 間隔の 2 回目が**黙って捨てられていた**。だから新しい一次操作でも、
 * 守るのはこの 2 点そのものにする。
 *
 * | 起きること | この一次操作の答え |
 * |---|---|
 * | 往復の最中にもう一度押された | **捨てない・閉じない。いま飛んでいる往復に相乗りする** |
 * | 相乗りした呼び出し元 | **同じ応答を受け取る** (先に押した人だけが得をする、を作らない) |
 * | 往復が落ちた | 相乗りした全員が同じ失敗を受け取る。記録は 1 回だけ残る |
 * | 決着したあと | 鍵を捨てる。次に押されたら**新しい往復を始める** |
 *
 * ### なぜ「相乗り」なのか (再入の扱いを明示的に決める)
 *
 * 取りうる形は 3 つあった。
 *
 *   - **捨てる** (`usePessimisticMutation` の `inFlight` と同じ) — 2 回目が
 *     `failed` になる。**これは採らない**。入場券は金銭・契約ではないので二重
 *     送信の実害が無く、一方で「押したのに失敗した」は元の実害そのもの
 *   - **もう 1 本飛ばす** — 券が 2 枚出る。捨てるより静かに悪い (窓口に無駄な
 *     負荷がかかり、どちらの券が使われたかも分からなくなる)
 *   - **相乗り** — 往復は 1 本、応答は全員に配る。**受付は開いたまま、返事は
 *     必ず返る**。これだけが上の 2 点を同時に満たす
 *
 * ## 交通整理 (`write-queue.ts`) とどう違うか
 *
 * `write-queue` は「同じ相手へ 1 本ずつ、あとから来た値で上書きしていく」ための
 * もので、**送った値が意味を持つ**書き込み向け。こちらは「同じ相手へ 1 本だけ、
 * 帰ってきたものを配る」ためのもので、**返ってきた値が意味を持つ**取得向け。
 * 両者は捌き方が逆なので 1 本にまとめない (まとめると、どちらの性質も薄まる)。
 *
 * React には依存しない。`write-queue.ts` と同じく、画面を持たずに単体で確かめ
 * られる形にしてある (unit プロジェクトは `environment: 'node'`)。
 */

import { logger } from "@/lib/log";

import type { MutationClass } from "./mutation-classes";

/** この一次操作が属する分類。正本は `mutation-classes.ts` の表。 */
export const REQUEST_RESPONSE_CLASS: MutationClass = "request-response";

/**
 * 往復の結末。**応答の本体を含む**のが既存の `WriteOutcome` との違い。
 *
 * 例外で返さないのは、相乗りした呼び出し元全員に同じものを配るため
 * (投げると「誰が受け取るか」が呼び出し順に依存してしまう)。
 */
export type RequestOutcome<TData> =
  | { status: "ok"; data: TData }
  | { status: "failed"; error: unknown };

/** 実際の往復。応答の本体を返す。 */
export type SendRequest<TInput, TData> = (input: TInput) => Promise<TData>;

export type RequestCoalescer<TInput, TData> = {
  /**
   * `key` の相手へ `input` を送る。**往復の最中に呼ばれたら相乗りする**
   * (弾かない・捨てない・2 本目を飛ばさない)。
   *
   * 返る Promise は必ず解決する (棄却しない)。失敗も `status: "failed"` として
   * 返るので、呼び出し側は「返事が来ない」を考えなくてよい。
   */
  run: (key: string, input: TInput, send: SendRequest<TInput, TData>) => Promise<RequestOutcome<TData>>;
  /**
   * いまその相手へ往復が飛んでいるか。
   *
   * **`disabled` に使わないこと。** この分類は受付を閉じないのが約束で、
   * これは進行の印 (`aria-busy` / 回転する印) のためにある。
   */
  isBusy: (key: string) => boolean;
};

type Entry<TData> = {
  /** この鍵の往復の結末を待っている呼び出し元。相乗りした全員がここに並ぶ。 */
  waiters: ((outcome: RequestOutcome<TData>) => void)[];
};

export function createRequestCoalescer<TInput, TData>(options?: {
  /**
   * どの操作の往復か。記録のタグになるので**固定文字列**にする
   * (`voice.token` など)。省略すると `unknown` として数えられる。
   */
  operation?: string;
}): RequestCoalescer<TInput, TData> {
  const operation = options?.operation ?? "unknown";
  const entries = new Map<string, Entry<TData>>();

  function settle(key: string, entry: Entry<TData>, outcome: RequestOutcome<TData>) {
    /* 先に台帳から外す。配っている最中に同じ鍵で呼ばれたら、それは
       「決着後の新しい往復」として扱うのが正しい (券は使い切りなので、
       決着済みの応答を配り続けると期限切れを掴ませることになる)。 */
    entries.delete(key);
    const waiters = entry.waiters;
    entry.waiters = [];
    for (const resolve of waiters) resolve(outcome);
  }

  async function start(key: string, input: TInput, send: SendRequest<TInput, TData>) {
    const entry = entries.get(key);
    if (!entry) return;
    try {
      const data = await send(input);
      settle(key, entry, { status: "ok", data });
    } catch (error) {
      /* 往復が落ちた唯一の合流点。言い直しは呼び出し側が受け持つが、
         **こちら側が気づけない**のを防ぐため記録は必ず残す (憲章 Wave 3 / R1)。
         相乗りが何人居ても記録は 1 回 — 同じ失敗を人数ぶん数えない。 */
      logger.error("ui.request.send-failed", error, { operation, key });
      settle(key, entry, { status: "failed", error });
    }
  }

  return {
    run(key, input, send) {
      const existing = entries.get(key);
      const settled = new Promise<RequestOutcome<TData>>((resolve) => {
        if (existing) {
          /* 相乗り。**ここで捨てない・閉じない**のがこの一次操作の要。 */
          existing.waiters.push(resolve);
          return;
        }
        const entry: Entry<TData> = { waiters: [resolve] };
        entries.set(key, entry);
        /* 待たせない。1 回目の申し込みはその場で往復を始める。 */
        void start(key, input, send);
      });
      return settled;
    },
    isBusy(key) {
      return entries.has(key);
    },
  };
}
