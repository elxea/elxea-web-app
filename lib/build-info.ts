/**
 * 「いま本番で何が配信されているか」を答えるための、ビルド時に焼き込まれた事実。
 *
 * 背景 (なぜ必要か):
 *   本番はサイトパスワードで守られており (middleware.ts)、エージェントはパスワードを
 *   入力できない。そのため「本番が古いデプロイのまま」でも誰も気づけず、実際に 14 時間
 *   気づかれなかった。`200 が返るか` の監視では、古いデプロイが生きていても緑になる。
 *   → 必要なのは「応答があるか」ではなく「**何が**配信されているか」。
 *
 * ここの値は `next.config.ts` の `env` でビルド時に文字列として埋め込まれる
 * (`process.env.NEXT_PUBLIC_*` はビルド時にリテラル置換される)。したがって
 * 実行時の環境変数に依存せず、**そのビルドの事実**を必ず返す。Edge Runtime
 * (middleware) からも参照できるよう Node API は一切使わない。
 *
 * 秘密は入れないこと。ここに置いた値は認証なしで公開される。
 */

/** 配信中のコミット SHA。取得できなければ "unknown" (呼び出し側は fail-closed 扱いにする)。 */
export const BUILD_SHA: string = process.env.NEXT_PUBLIC_BUILD_SHA || "unknown";

/** 短縮 SHA (7 桁)。"unknown" のときはそのまま "unknown"。 */
export const BUILD_SHA_SHORT: string =
  BUILD_SHA === "unknown" ? "unknown" : BUILD_SHA.slice(0, 7);

/** ビルド時刻 (ISO8601 / UTC)。SHA が取れない環境でも「いつのビルドか」は必ず分かる。 */
export const BUILD_TIME: string = process.env.NEXT_PUBLIC_BUILD_TIME || "unknown";

/** production / preview / development。 */
export const BUILD_ENV: string = process.env.NEXT_PUBLIC_BUILD_ENV || "unknown";

/**
 * Vercel のデプロイ ID。CLI デプロイでは git メタデータが欠けることがあるが、
 * この ID は必ず付く。SHA が "unknown" でも「どのデプロイか」は一意に特定できる。
 */
export const BUILD_DEPLOYMENT_ID: string =
  process.env.NEXT_PUBLIC_BUILD_DEPLOYMENT_ID || "unknown";

/**
 * 公開してよい**状態のみ**の集合。ページの中身は一切含めない。
 *
 * このオブジェクトのキー集合は `__tests__/api-version.test.ts` で固定してある。
 * 新しいフィールドを足すと**テストが落ちる**ので、「うっかり他の情報まで返す」
 * 事故が起きない。足すときは公開してよい値かを判断した上でテストも更新すること。
 */
export function getPublicBuildInfo() {
  return {
    sha: BUILD_SHA,
    shaShort: BUILD_SHA_SHORT,
    builtAt: BUILD_TIME,
    env: BUILD_ENV,
    deploymentId: BUILD_DEPLOYMENT_ID,
  } as const;
}

/** 全レスポンスに付ける、配信ビルドを示すヘッダー名。 */
export const BUILD_HEADER = "x-elxea-build";
