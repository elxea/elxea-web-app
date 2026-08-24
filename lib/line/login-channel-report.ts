/**
 * 名前空間ガードの「鳴らし方」だけを持つ薄い層（M-0）。
 *
 * 判定そのものは `lib/line/login-channel.ts` の `checkChannelNamespace` にあり、
 * こちらは **副作用（ログ・Sentry）と、鳴らしすぎない仕掛け**だけを担う。分けているのは、
 * 判定を純関数のままテストできるようにするため。
 *
 * ## なぜ 503 で落とさないのか
 *
 * チャネル ID の不一致は「連携が永久に成立しない」という重い欠陥だが、**ログインは
 * 成立する**。ここで fail-closed にすると、連携を直すための変更でログインまで
 * 巻き添えにする — 直そうとしている症状より悪い壊し方になる。よって
 * **落とさずに、必ず記録に残す**。
 *
 * これは G3（3 値を 2 値に丸めない）と同じ立て付けでもある。「設定が無い」
 * （プレビュー等・正常）と「設定が食い違う」（異常）を別の事実として扱い、
 * 前者では鳴らさない。前者で鳴らすと後者が埋もれる。
 *
 * ## なぜ 1 プロセス 1 回なのか
 *
 * 認可 URL の組み立てはログインのたびに走る。毎回 Sentry に送るとログイン数だけ
 * イベントが出て、割り当てを食い潰したうえ「いつも鳴っているから無視」される。
 * env はプロセスの寿命の間は変わらないので、1 回で事実は伝わる。
 */
import * as Sentry from "@sentry/nextjs";

import { checkChannelNamespace } from "@/lib/line/login-channel";

/** 同一プロセス内で既に報告した呼び出し元。 */
const reported = new Set<string>();

/** テスト用。プロセス内キャッシュを捨てる。 */
export function resetChannelNamespaceReportCache(): void {
  reported.clear();
}

/**
 * チャネル ID 群の一致を検査し、食い違っていたら記録に残す。
 *
 * @param source どの経路から呼ばれたか（切り分け用。判断には使わない）
 * @returns 検査結果（呼び出し側は無視してよい）
 */
export function reportChannelNamespace(source: string) {
  const result = checkChannelNamespace();
  if (result.ok || result.reason === "not-configured") return result;

  if (reported.has(source)) return result;
  reported.add(source);

  /* 文言に "line" を含めるのは監視の取得側の都合。ログ取得は
     `vercel logs --query line` で絞っており、この語が無い行は取得段階で落ちる。 */
  console.error(
    `[line-channel] LINE channel namespace mismatch (source=${source}): ${result.detail}`,
  );
  Sentry.captureMessage("LINE channel namespace mismatch", {
    level: "error",
    tags: { subsystem: "line-channel", source },
    extra: { detail: result.detail },
  });

  return result;
}
