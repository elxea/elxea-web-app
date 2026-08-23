/**
 * Ring 2 の dev サーバーを、テストが始まる前に温めておく。
 *
 * ## なぜ要るのか
 *
 * `next dev` はルートを **最初のリクエストで初めてコンパイルする**。冷えた Turbopack と
 * GitHub runner の組み合わせでは、最初の `page.goto("/ja/login")` 1 本がテストの制限時間
 * (120 秒) を食い潰すことがある。しかもその失敗は素直なタイムアウトではなく
 * `net::ERR_ABORTED; maybe frame was detached?` として出るので、**ハーネスの遅さが
 * プロダクトの不具合のように見える**。
 *
 * 実測 (2026-08-23): PR 上では 2 回とも緑 (2m18s / 3m10s)、main へ squash した直後の
 * run で ① が 2.1 分かけて上記の形で落ちた。走らせるコードは同じで、違いはランナーの
 * 機嫌だけ。つまりこれは「たまに落ちる」であって、リトライで隠してよいものではない。
 *
 * ## 何をしているか
 *
 * テスト開始前に、suite が使うルートを Node から 1 回ずつ叩いてコンパイルを済ませる。
 * コンパイル時間は **globalSetup の予算**で払われ、個々のテストの制限時間からは外れる。
 * 待ち時間を伸ばして誤魔化すのではなく、待つ場所を正しいところへ移す。
 *
 * ## なぜ 127.0.0.1 なのか
 *
 * 偽アペックス (`*.elxea.test`) を解決できるのは Chromium だけで、Node からは引けない
 * (config の `webServer.url` が 127.0.0.1 なのと同じ理由)。ホスト名が違うと
 * `isTrustedAuthHost` の判定は変わるが、**ルートがコンパイルされるかどうかは変わらない**
 * ので、温める目的には十分。応答の中身は一切見ない。
 *
 * ## 失敗しても止めない
 *
 * ここは最適化であって検証ではない。温められなかったときに落とすと、遅いだけのランナーで
 * 赤を作ることになる。警告だけ出して先へ進み、判断はテスト本体に委ねる。
 */

/** 1 ルートあたりの上限。コンパイルが本当に終わらないときに無限に待たないため。 */
const PER_ROUTE_TIMEOUT_MS = 240_000;

export default async function warmDevServer(): Promise<void> {
  const base = process.env.E2E_WARMUP_BASE_URL;
  const paths = (process.env.E2E_WARMUP_PATHS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!base || paths.length === 0) return;

  for (const path of paths) {
    const startedAt = Date.now();
    try {
      await fetch(`${base}${path}`, {
        /* リダイレクトは追わない。狙いは「そのルートをコンパイルさせる」ことで、
         * 追うと関係ないルートまで巻き込んで遅くなる。 */
        redirect: "manual",
        signal: AbortSignal.timeout(PER_ROUTE_TIMEOUT_MS),
      });
      console.log(`[warmup] ${path} ${Date.now() - startedAt}ms`);
    } catch (err) {
      console.warn(
        `[warmup] ${path} を温められなかった (${Date.now() - startedAt}ms): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
