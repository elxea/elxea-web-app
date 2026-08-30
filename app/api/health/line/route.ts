/**
 * GET /api/health/line — LINE のチャネル資格情報が今この瞬間に通るかを答える。
 *
 * ## なぜ居るのか (消す前に読むこと)
 *
 * 2026-08-22 と 2026-08-25、**コードは無傷のまま**本番の LINE 連携／ログインが全滅した。
 * どちらも Channel Secret 側の設定破壊（末尾改行の混入 / 別チャネルの値）で、token 交換が
 * 毎回 `400 invalid_client` を返していた。CI も E2E も緑。壊れたと分かるのは、実際の
 * お客さんがログインに失敗して、それがこちらに届いたときだけだった。
 *
 * この route は **人間の LINE アカウントを使わずに**その破壊を直接観測する。わざと無効な
 * 認可コードで token 交換を叩き、LINE が資格情報の段階で拒む (`invalid_client`) のか、
 * 資格情報は通してグラントで拒む (`invalid_grant` 等) のかを見る。判定の理屈は
 * `lib/line/credential-probe.ts` の doc に書いてある。
 *
 * これが埋めるのはログ監視の穴である。ログ検知は「落ちた人がいた痕跡」しか拾えず、
 * 誰も踏まない時間帯の破壊は拾えない。しかも Hobby プランのログ保持は 1 時間なので、
 * 拾えなかった区間は消える。こちらは踏む人がゼロでも必ず答えが出る。
 * 30 分ごとの `monitor-line-prod` がこの route を叩き、`misconfigured` なら Issue が立つ。
 *
 * ## なぜ認証を掛けないのか
 *
 * 掛けると監視から叩けなくなる（GitHub Actions 側にこのサイト用の秘密は無い）。
 * 代わりに **何も漏らさない**ことで安全を確保している:
 *
 *   - 応答に channel id / secret / `error_description` の本文は一切載せない。
 *     出るのは判定語 (`ok` / `misconfigured` / …) と HTTP ステータス、LINE の
 *     `error` コード（RFC 6749 の語彙。`[a-z_]` に正規化済み）だけ。
 *   - 資格情報が正しいか否かは、そもそも**ログイン画面を 1 回踏めば誰でも分かる**
 *     事実であって、秘密ではない。
 *
 * ## なぜキャッシュするのか
 *
 * 認証が無い = 誰でも叩ける = 1 リクエストごとに LINE へ 1 往復させられる、が成り立って
 * しまう。判定はそう頻繁に変わるものではないので、プロセス内に短時間だけ持つ。監視は
 * 30 分間隔なので取りこぼしは生じない。
 */
import { NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/base-url";
import {
  probeChannelCredentials,
  verdictHttpStatus,
  worstVerdict,
  type CredentialProbeResult,
  type CredentialVerdict,
} from "@/lib/line/credential-probe";
import {
  resolveLoginChannelId,
  resolveLoginChannelSecret,
} from "@/lib/line/login-channel";
import {
  resolveLinkChannelId,
  resolveLinkChannelSecret,
} from "@/lib/line/link-flow";
import { probeLedgerSharedSecret } from "@/lib/line/ledger-auth";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

/** 判定を持ち回す時間。監視間隔 (30 分) より十分短い。 */
const CACHE_TTL_MS = 60_000;

type CachedBody = {
  status: CredentialVerdict;
  checkedAt: string;
  channels: Record<string, CredentialProbeResult>;
};

/* Next.js の route file は決められた名前しか export できないため、リセット用の
   関数を生やせない。テストは `vi.resetModules()` + 動的 import でモジュールごと
   入れ替えてキャッシュを捨てる (`__tests__/line-health-route.test.ts`)。 */
let cache: { at: number; httpStatus: number; body: CachedBody } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return jsonResponse(cache.httpStatus, cache.body, { cached: true });
  }

  /* `redirect_uri` は **チャネルごとに本番経路が使うのと同じ値**を送る。
     LINE は token 交換で redirect_uri の一致も見るが、その不一致は
     `invalid_grant` 側に出るので資格情報の判定には影響しない。それでも本番と
     揃えるのは、将来 LINE が検査順を変えたときに、ここだけが違う挙動をして
     「ヘルスチェックは緑なのにログインは落ちる」が生まれるのを避けるため。 */
  const origin = getBaseUrl();

  /* 2 チャネルを並列で見る。直列にすると片方の timeout がもう片方を押し出す。 */
  const [login, link, ledger] = await Promise.all([
    probeChannelCredentials({
      channelId: resolveLoginChannelId(),
      channelSecret: resolveLoginChannelSecret(),
      redirectUri: `${origin}/api/line-callback`,
    }),
    probeChannelCredentials({
      channelId: resolveLinkChannelId(),
      channelSecret: resolveLinkChannelSecret(),
      redirectUri: `${origin}/api/user/line-link/callback`,
    }),
    /* 3 本目: web-app と cx-agent の共有鍵（2026-08-30 の障害の当事者）。
     *
     * LINE のチャネル資格情報が 2 つとも通っていても、この鍵がずれていれば
     * 連携は全経路で落ちる。実際 08-30 はチャネル側が無傷のまま連携だけが
     * 全滅し、この health は緑のままだった。**壊れたものが観測範囲の外に
     * あったので、監視は何も言えなかった。** 同じ画面で一緒に見る。 */
    probeLedgerSharedSecret({
      baseUrl: CX_AGENT_BASE_URL,
      secret: env("SYNC_API_SECRET"),
    }),
  ]);

  const status = worstVerdict([login.verdict, link.verdict, ledger.verdict]);
  const httpStatus = verdictHttpStatus(status);
  const body: CachedBody = {
    status,
    checkedAt: new Date(now).toISOString(),
    channels: { login, link, ledger },
  };

  cache = { at: now, httpStatus, body };
  return jsonResponse(httpStatus, body, { cached: false });
}

function jsonResponse(httpStatus: number, body: CachedBody, meta: { cached: boolean }) {
  return NextResponse.json(
    { ...body, cached: meta.cached },
    {
      status: httpStatus,
      headers: {
        // 監視は常に最新の判定を見たい。CDN に持たせない。
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
