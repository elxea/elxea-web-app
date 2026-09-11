/**
 * cx-agent の消去 API を呼ぶ（M-5 / Issue A）。
 *
 * ## 何が欠けていたか
 *
 * cx-agent には `POST /api/erase` が実装済みで、設計意図もコードにこう書いてある —
 * 「消す範囲の**過半（Supabase 全表と未連携カルテ）がこの worker からしか触れない**ため、
 * web-app 側の `customers/redact` はここを呼ぶだけにして、『何が消える範囲か』の定義を
 * 1 か所に集約する」(`src/index.ts:299-301`)。
 *
 * **その呼び出しが一度も書かれていなかった。** 2026-08-25 の実測では
 * `git grep 'ERASE_API_SECRET\|api/erase' origin/main` がコメント 1 件のみで、実呼び出しは
 * ゼロだった。つまり Shopify から削除要求が来ると、web-app は Firestore の
 * `users/{顧客番号}/**` を消して 200 を返し、**Supabase の連携台帳・会話履歴・カルテは
 * 丸ごと残ったまま**「消しました」と答えていた。
 *
 * ## 202 を成功として扱ってはならない
 *
 * `/api/erase` は `#42` 以降 **3 分岐**で応答する。
 *
 * | 応答 | 意味 |
 * |---|---|
 * | `200 {status:"erased"}` | 消し終わった（residue 検算も clean） |
 * | `202 {status:"in_progress", continue_required:true}` | **途中まで**しか消していない |
 * | `500` | 全経路を回したのに消し残しがある = 異常 |
 *
 * 202 は Workers の subrequest 上限に当たった形で、**2xx だが完了ではない**。素朴に
 * `res.ok` で判定すると、ここが静かに「成功」になって消し残しが残る。各段階は冪等なので
 * **`continue_required` が false になるまで呼び直す**ところまでがこの関数の責務。
 *
 * ## なぜ回数と時間の両方に上限を置くのか
 *
 * webhook の応答には実質的な制限時間があり、無限に回すと Shopify 側がタイムアウトして
 * 結局リトライになる。しかも「呼び出しは進んでいるのに応答は落ちる」ので、進捗が
 * 見えない形で時間だけ溶ける。
 *
 * よって上限に達したら **打ち切って失敗を返す**。呼び出し側が 5xx を返せば Shopify が
 * 再送し、消去は冪等なので**続きから進む**。「時間内に終わらなかった」を「終わった」に
 * しないことだけが要件で、1 回で終わらせる必要はない。
 */
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { readSecretEnvTrimmed } from "@/lib/env";

/** 誰を消すか。cx-agent の `subject_kind` / `subject_id` にそのまま対応する。 */
export type EraseSubject =
  | { kind: "shopify"; id: string }
  | { kind: "line"; id: string };

/**
 * 何が起きたか。
 *
 * 失敗の種別を潰さないのは、呼び出し側が「Shopify に再送させるべきか」を
 * 判断できるようにするため。`not-configured` は再送しても直らない（人が env を
 * 入れるまで永久に失敗する）ので、他と混ぜると再送が無駄に走り続ける。
 */
export type EraseResult =
  | { ok: true; attempts: number }
  | {
      ok: false;
      /**
       * - `not-configured`     … 鍵が無い。**再送では直らない**
       * - `unauthorized`       … 鍵が違う（401/403）。**再送では直らない**
       * - `incomplete`         … cx-agent が消し残しを検出（500）
       * - `budget-exhausted`   … 202 が続き、上限まで消しきれなかった。**再送で進む**
       * - `unreachable`        … 届かない / タイムアウト。**再送で進みうる**
       * - `bad-response`       … 応答の形が契約と違う
       */
      reason:
        | "not-configured"
        | "unauthorized"
        | "incomplete"
        | "budget-exhausted"
        | "unreachable"
        | "bad-response";
      detail: string;
      attempts: number;
      /** Shopify に再送させる価値があるか（＝5xx を返してよいか）。 */
      retryable: boolean;
    };

/** 1 リクエストあたりの待ち時間。cx-agent 側は段階ごとに区切って返すので長すぎなくてよい。 */
const REQUEST_TIMEOUT_MS = 20_000;
/** 202 の続きを呼ぶ最大回数。 */
const MAX_ATTEMPTS = 6;
/** 全体の時間予算。webhook の応答が返らなくなる前に打ち切る。 */
const TOTAL_BUDGET_MS = 60_000;

type EraseBody = {
  status?: string;
  continue_required?: boolean;
  error?: string;
};

/**
 * cx-agent に消去を依頼し、消し終わるまで呼び直す。
 *
 * **決して throw しない。** 呼び出し側（webhook ハンドラ）が結果を見て応答を決める。
 *
 * @param subject 消す対象。ID は**サーバ確定値**のみ（webhook の署名検証を通った payload）。
 */
export async function eraseInCxAgent(
  subject: EraseSubject,
  options: {
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    totalBudgetMs?: number;
    now?: () => number;
  } = {},
): Promise<EraseResult> {
  const secret = readSecretEnvTrimmed(process.env.ERASE_API_SECRET);
  if (!secret) {
    /* ここを「設定が無いので何もしなくてよい」に倒すと、**消えていないのに
       消しましたと答える**状態が env の不備だけで復活する。それは今回直している
       欠陥そのものなので、失敗として返す。再送では直らないので retryable=false。 */
    return {
      ok: false,
      reason: "not-configured",
      detail: "ERASE_API_SECRET is not set; cannot erase cx-agent data",
      attempts: 0,
      retryable: false,
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const budgetMs = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  let attempts = 0;

  while (attempts < maxAttempts) {
    if (attempts > 0 && now() - startedAt >= budgetMs) {
      return {
        ok: false,
        reason: "budget-exhausted",
        detail: `time budget ${budgetMs}ms exhausted after ${attempts} attempt(s)`,
        attempts,
        retryable: true,
      };
    }

    attempts++;

    let res: Response;
    try {
      res = await doFetch(`${CX_AGENT_BASE_URL}/api/erase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          /* `SYNC_API_SECRET` とは**別鍵**。消去だけを許す鍵を分けてあるので、
             取り違えると 401 になる（そして 401 は再送では直らない）。 */
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          subject_kind: subject.kind,
          subject_id: subject.id,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        reason: "unreachable",
        detail: err instanceof Error ? err.message : String(err),
        attempts,
        retryable: true,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "unauthorized",
        detail: `cx-agent rejected the erase credential (${res.status})`,
        attempts,
        retryable: false,
      };
    }

    let body: EraseBody = {};
    try {
      body = (await res.json()) as EraseBody;
    } catch {
      /* 本文が読めなくても status だけで判断できる場合がある。空のまま進む。 */
    }

    if (res.status === 200 && body.status === "erased") {
      return { ok: true, attempts };
    }

    if (res.status === 202 && body.continue_required === true) {
      /* 途中まで消えた。**失敗ではない**。同じ body で呼び直すと続きから消える。 */
      continue;
    }

    if (res.status >= 500) {
      /* `status:"incomplete"` は「全経路を回したのに消し残しがある」= 異常。
         再送しても同じ結果になる公算が高いが、一時障害の可能性も残るので
         retryable にして Shopify の再送に委ねる（消去は冪等なので害が無い）。 */
      return {
        ok: false,
        reason: "incomplete",
        detail: `cx-agent reported ${body.status ?? res.status}`,
        attempts,
        retryable: true,
      };
    }

    /* 200 なのに `status` が `erased` でない / 202 なのに `continue_required` が無い等。
       契約と違う応答を「たぶん成功」と読むのが、この一連の欠陥の作られ方だった。 */
    return {
      ok: false,
      reason: "bad-response",
      detail: `unexpected response ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
      attempts,
      retryable: true,
    };
  }

  return {
    ok: false,
    reason: "budget-exhausted",
    detail: `still in progress after ${maxAttempts} attempt(s)`,
    attempts,
    retryable: true,
  };
}
