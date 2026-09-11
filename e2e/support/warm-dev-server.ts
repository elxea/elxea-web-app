/**
 * Ring 2 の dev サーバーを、テストが始まる前に温めておく。
 *
 * ## なぜ要るのか
 *
 * `next dev` はルートを **最初のリクエストで初めてコンパイルする**。冷えた Turbopack と
 * GitHub runner の組み合わせでは、最初の `page.goto("/ja/login")` 1 本がテストの制限時間
 * を食い潰すことがある。しかもその失敗は素直なタイムアウトではなく
 * `net::ERR_ABORTED; maybe frame was detached?` として出るので、**ハーネスの遅さが
 * プロダクトの不具合のように見える**。
 *
 * 実測 (2026-08-23, main の run 32620718882): ① が 2.1 分かけて上記の形で落ちた。
 * 走らせるコードは同じで、違いはランナーの機嫌だけ。つまりこれは「たまに落ちる」で
 * あって、リトライで隠してよいものではない。
 *
 * ## 何をしているか
 *
 * テスト開始前に、suite が使うルートを Node から 1 回ずつ叩いてコンパイルを済ませる。
 * コンパイル時間は **globalSetup の予算**で払われ、個々のテストの制限時間からは外れる。
 * 待ち時間を伸ばして誤魔化すのではなく、待つ場所を正しいところへ移す。
 *
 * ## 初版に残っていた 3 つの穴 (2026-08-24 に塞いだ)
 *
 * 1. **温めたつもりのルートが温まっていなかった。** `middleware.ts` は
 *    `/{locale}/account` をセッション cookie が無いときに `/{locale}/login` へ
 *    リダイレクトする。cookie 無しの素の fetch はそこで折り返すので、
 *    **account ページ本体は 1 行もコンパイルされない**。緑の run のログでも
 *    `[warmup] /ja/account 8ms` と出ていて、8ms は「何もしていない」の証拠だった。
 *    → `E2E_WARMUP_COOKIE` で門を通す (下の `cookieHeader` の項を参照)。
 *
 * 2. **温める先が足りなかった。** suite は `/ja/login/complete` や
 *    `/api/line-callback`、`/api/user/line-link/*`、`/api/auth/*` も通るのに、
 *    温めていたのは 3〜4 本だけ。残りの初回コンパイルはテストの制限時間の中に
 *    居座り続けていた (`waitForURL` が待ち続ける形で出る)。
 *    → 各 config が **suite の通る道を全部** 列挙する。
 *
 * 3. **温められなくても黙って進んでいた。** 「ここは最適化だから落とさない」は、
 *    温めが効かなかったときに **コンパイル待ちをテストへ差し戻す**ことを意味する。
 *    差し戻された先ではそれがプロダクトの不具合の顔をして出る。原因と症状を
 *    取り違えさせないために、温められなかったらここで落とす。落ちたときの
 *    メッセージは「ハーネスがルートをコンパイルさせられなかった」と読める。
 *
 * ## なぜ 127.0.0.1 なのか
 *
 * 偽アペックス (`*.elxea.test`) を解決できるのは Chromium だけで、Node からは引けない
 * (config の `webServer.url` が 127.0.0.1 なのと同じ理由)。ホスト名が違うと
 * `isTrustedAuthHost` の判定は変わるが、**ルートがコンパイルされるかどうかは変わらない**
 * ので、温める目的には十分。応答の中身は一切見ない。
 *
 * ## 2 周目を必ず走らせる理由
 *
 * 1 周目が返ってきても、それは「そのとき応答した」でしかない。dev サーバーが
 * (Turbopack の内部 panic などで) 状態を失っていれば、次に叩いたときにまた
 * 一からコンパイルする。2 周目を **短い制限時間** で回して全部が即答することを
 * 確かめると、「コンパイル結果が残っている」ところまで確認できる。ここを通って
 * いれば、テスト中に出る遅さはハーネス起因ではないと言い切れる。
 */

/** 1 回の試行の上限。コンパイルが本当に終わらないときに無限に待たないため。 */
const PER_ATTEMPT_TIMEOUT_MS = 120_000;

/** 1 ルートあたりの試行回数。冷えたコンパイル中の socket 切断は 1 度は起こりうる。 */
const ATTEMPTS_PER_PATH = 2;

/**
 * 温め全体の予算。緑の run では合計 3 秒前後で終わる (実測 2026-08-23) ので、
 * 100 倍近い余裕がある。ここに当たるのは「もう手遅れ」のときだけ。
 */
const TOTAL_BUDGET_MS = 300_000;

/**
 * 2 周目の上限。1 周目でコンパイル済みなら数十 ms〜数百 ms で返る。30 秒を
 * 超えるのは、コンパイル結果が残っていない (= dev サーバーが状態を失った) とき。
 */
const SECOND_PASS_TIMEOUT_MS = 30_000;

class WarmupError extends Error {
  constructor(message: string) {
    super(`[warmup] ${message}`);
    this.name = "WarmupError";
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    /* fetch の失敗は cause 側に本当の理由 (ECONNRESET 等) が入る。 */
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.message}${causeText}`;
  }
  return String(err);
}

export default async function warmDevServer(): Promise<void> {
  const base = process.env.E2E_WARMUP_BASE_URL;
  const paths = (process.env.E2E_WARMUP_PATHS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!base || paths.length === 0) return;

  /**
   * 門を通すためだけの cookie。**値は検証されない** — `middleware.ts` は
   * `request.cookies.has("line_session")` の **有無** しか見ないので、合成値で
   * リダイレクトを回避してページ本体までリクエストを届かせられる。
   *
   * ここで作られるセッションは無い (中身は復号できない偽値なので、ページ側は
   * 未ログインとして描画するか、その場でエラーになる)。**どちらでもよい** —
   * 欲しいのは「ルートモジュールがコンパイルされること」だけで、応答は見ない。
   */
  const cookieHeader = process.env.E2E_WARMUP_COOKIE;
  const headers = cookieHeader ? { cookie: cookieHeader } : undefined;

  const startedAll = Date.now();
  const remainingBudget = () => TOTAL_BUDGET_MS - (Date.now() - startedAll);

  /* ---- 1 周目: コンパイルさせる ---- */
  for (const path of paths) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_PATH; attempt += 1) {
      const budget = remainingBudget();
      if (budget <= 0) {
        throw new WarmupError(
          `全体の予算 ${TOTAL_BUDGET_MS}ms を使い切った (${path} まで到達)。` +
            `dev サーバーがルートをコンパイルできていない。`,
        );
      }

      const startedAt = Date.now();
      try {
        await fetch(`${base}${path}`, {
          headers,
          /* リダイレクトは追わない。狙いは「そのルートをコンパイルさせる」ことで、
           * 追うと関係ないルートまで巻き込んで遅くなる。 */
          redirect: "manual",
          signal: AbortSignal.timeout(Math.min(PER_ATTEMPT_TIMEOUT_MS, budget)),
        });
        console.log(`[warmup] ${path} ${Date.now() - startedAt}ms`);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.warn(
          `[warmup] ${path} 試行 ${attempt}/${ATTEMPTS_PER_PATH} 失敗 ` +
            `(${Date.now() - startedAt}ms): ${describe(err)}`,
        );
      }
    }

    if (lastError) {
      throw new WarmupError(
        `${path} をコンパイルさせられなかった: ${describe(lastError)}。` +
          `これはハーネス (dev サーバーの起動・コンパイル) 側の失敗で、` +
          `プロダクトの不具合ではない。`,
      );
    }
  }

  /* ---- 2 周目: コンパイル結果が残っていることを確かめる ---- */
  for (const path of paths) {
    const startedAt = Date.now();
    try {
      await fetch(`${base}${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(SECOND_PASS_TIMEOUT_MS),
      });
    } catch (err) {
      throw new WarmupError(
        `${path} の 2 周目が ${Date.now() - startedAt}ms で失敗した: ${describe(err)}。` +
          `1 周目は通っているので、dev サーバーがコンパイル結果 (あるいはプロセス自体) を` +
          `失っている。テストを走らせても症状しか見えないのでここで止める。`,
      );
    }
    console.log(`[warmup:verify] ${path} ${Date.now() - startedAt}ms`);
  }

  console.log(
    `[warmup] ${paths.length} ルートを ${Date.now() - startedAll}ms で温め、再確認まで完了`,
  );
}
