import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireAuth } from "@/lib/firebase/auth-guard";
import { applyLinkageEstablishedWithinBudget } from "@/lib/auth/linkage-merge-handoff";
import { getBaseUrl, getRequestOrigin } from "@/lib/base-url";
import { getCookieSpec, resolveCookieDomain } from "@/lib/auth/cookies";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { verifyLineIdToken } from "@/lib/line/verify-liff-token";
import { lineApiBaseUrl } from "@/lib/line/endpoints";
import {
  LINE_LINK_STATE_COOKIE,
  defaultReturnTo,
  openLinkState,
  resolveLinkChannelId,
  resolveLinkChannelSecret,
  returnUrlWithResult,
} from "@/lib/line/link-flow";
import {
  classifyTokenExchangeError,
  reportMisconfiguredChannel,
} from "@/lib/line/token-error";

/**
 * GET /api/user/line-link/callback — Web 発 LINE 連携の帰り道（P2）。
 *
 * ## この route が果たす約束
 *
 * **必ずマイページに戻す。** 成功でも失敗でも、行き止まりの画面を出さない。旧 LIFF 導線は
 * 完了後に「トークに戻る」しか出口が無く、元のブラウザのマイページへ帰れなかった。それが
 * P2 で直したい体験そのものなので、ここは常に `returnTo`（= 開始時に封じた自サイト内パス）
 * への 302 で終わる。連携完了画面は作らない。結果は `?line_link=success|error` で伝え、
 * 実際の状態表示は P1 の読み取り（`fetchLineLinkageStatus`）が担う。
 *
 * ## 連携を成立させる条件（fail-closed）
 *
 * 1. `openLinkState` の 4 条件（復号可 / state 一致 / **顧客一致** / 期限内）
 * 2. LINE の token 交換が成功し、`id_token` がある
 * 3. `verifyLineIdToken` が LINE の verify API で通る（aud / iss / exp / **nonce** / sub 形式）
 * 4. `SYNC_API_SECRET` があり、cx-agent の upsert が 2xx を返す
 *
 * どれか 1 つでも欠けたら `?line_link=error` で戻す。「たぶん成功した」で成功を名乗らない。
 *
 * ## なぜ `verifyLineIdToken` を使い回すのか
 *
 * 名前は LIFF だが、実体は「この Login チャネルが発行した id_token を LINE に検証させ、
 * `sub`（= 同一プロバイダーなら Messaging userId）を取り出す」関数で、認可の入口が
 * LIFF か Web かには依存しない。同じ検証を 2 つ書くと、片方だけ緩む日が必ず来る。
 *
 * ## 秘密の扱い
 *
 * token 交換の client_secret も cx-agent の `SYNC_API_SECRET` も **サーバ環境変数のみ**。
 * ブラウザには一切出さない。LINE の userId もクエリや cookie に出さない（P1 の最小開示と同じ）。
 *
 * ## 所要時間は必ず内訳ごと残す（2026-08-25）
 *
 * この route は成功したとき **何も記録していなかった**。そのため本番で
 * 「認可のあと真っ白な画面が続く」と報告されたとき、どの段が遅いのかを
 * 手元から知る方法が無く、Vercel の request log にある関数全体の 20.1 秒
 * （hot start）という 1 つの数字から先へ進めなかった。
 *
 * いま各段の ms を 1 行にまとめて出す。**識別子は一切載せない**（顧客 ID も
 * LINE userId も出さない = P1 の最小開示と同じ）。載せるのは段の名前と数字だけ。
 * これは「静かに成功して、静かに遅い」を無くすための計装であって、
 * 判断には使わない。
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  /** 段ごとの所要 ms。値は数字だけで、識別子は入れない。 */
  const phases: Record<string, number> = {};
  /** `phase("auth", () => ...)` で包んだ区間の所要時間を `phases` に貯める。 */
  const phase = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
    const from = Date.now();
    try {
      return await run();
    } finally {
      phases[name] = Date.now() - from;
    }
  };
  const timings = () =>
    Object.entries(phases)
      .map(([name, ms]) => `${name}=${ms}ms`)
      .join(" ");

  const locale = resolveLocale(request);
  const fallbackReturn = defaultReturnTo(locale);

  /* 戻り先は **ユーザーが宛てたオリジン**から組む（`request.url` からではない）。
   *
   * `request.url` はサーバーが束ねられているオリジンを報告する。Vercel ではそれが
   * リクエストの Host と一致するのでこの route は動いているように見えるが、それ以外
   * ——dev サーバー、プロキシの後ろ——では一致せず、連携を終えた人を**サーバー自身の
   * オリジン**へ放り出す。別オリジンに着いた人には apex スコープのセッション cookie が
   * 適用されないので、**連携は成功したのにログアウト状態のログイン画面に着く**。
   *
   * これは推測ではなく、この route を初めて端から端まで踏んだ E2E
   * （`e2e/line-linkage-flow.spec.ts` ②）が実測で捕まえた。同じ穴は
   * `app/api/line-callback` で既に `getRequestOrigin` に直してあり（同 route の冒頭に経緯）、
   * こちらだけ直っていなかった。
   *
   * `getRequestOrigin` は fail-closed で、見知らぬ Host は `nextUrl.origin` に落ちる。
   * よって偽装ヘッダーでオープンリダイレクトにはならない。 */
  const requestOrigin = getRequestOrigin(request);

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(LINE_LINK_STATE_COOKIE)?.value;

  /* state cookie は、この先どの経路を通っても必ず捨てる（使い捨て）。残しておくと
   * 同じ state で二度目の callback を踏ませる余地が生まれる。Domain は発行時と同じ
   * 導出（`resolveCookieDomain`）でなければ delete が黙って何もしないので注意。 */
  const clearState = () => {
    const spec = getCookieSpec(LINE_LINK_STATE_COOKIE)!;
    const domain = spec.scope === "shared-domain" ? resolveCookieDomain(request) : undefined;
    cookieStore.delete({
      name: LINE_LINK_STATE_COOKIE,
      path: "/",
      ...(domain ? { domain } : {}),
    });
  };

  const fail = (returnTo: string, reason: string) => {
    /* 失敗のときも所要時間の内訳を添える。「遅くて落ちた」と「速く落ちた」は
       原因がまるで違うのに、理由だけだと区別がつかない。 */
    console.warn(
      `[line-link/callback] ${reason} (total=${Date.now() - startedAt}ms ${timings()})`,
    );
    clearState();
    return NextResponse.redirect(new URL(returnUrlWithResult(returnTo, "error"), requestOrigin));
  };

  /* 顧客 ID はここでも **その場のセッション**から取り直す。cookie に封じた値を
   * そのまま信じないのは、往復中にログアウト・別アカウントへの切替が起こりうるため。
   * 一致しなければ連携しない（それが state 束縛の 3 番目の条件）。 */
  const auth = await phase("auth", requireAuth);
  if (!auth.authenticated) {
    return fail(fallbackReturn, "no shopify session on return");
  }

  const opened = openLinkState(
    stateCookie,
    request.nextUrl.searchParams.get("state"),
    auth.customerId,
  );
  if (!opened.ok) {
    return fail(fallbackReturn, `state rejected: ${opened.reason}`);
  }
  const returnTo = opened.returnTo;
  /* 認可開始時に封じた nonce。id_token 検証にそのまま渡す（D11）。 */
  const expectedNonce = opened.nonce;

  const lineError = request.nextUrl.searchParams.get("error");
  if (lineError) {
    /* ユーザーが LINE 側で「キャンセル」した場合もここに来る。異常ではないので
     * 静かにマイページへ戻す（結果は error = 連携していない、で正しい）。 */
    return fail(returnTo, `line returned error: ${lineError}`);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return fail(returnTo, "no authorization code");

  const channelId = resolveLinkChannelId();
  /* client_secret は LINE_LIFF_CHANNEL_SECRET を優先し、未設定なら既存の
   * LINE_LOGIN_CHANNEL_SECRET にフォールバックする。LINE_LIFF_CHANNEL_ID と
   * LINE_LOGIN_CHANNEL_ID は同一 Login チャネル (本番 2011239425) を指すため、その Channel Secret は
   * LINE_LOGIN_CHANNEL_SECRET と同値であり、client_id (= LINE_LIFF_CHANNEL_ID) と整合する。
   * 本番 Vercel に新規シークレットを追加せず既存 env で連携を成立させるための措置。
   *
   * **どちらも env の値をそのまま使わず trim する。** ここが 2026-08-22 の本番障害の現場で、
   * 保存時に紛れ込んだ末尾改行 1 文字のせいで下の token 交換が毎回
   * `400 invalid_client / invalid client_secret` を返していた。詳細と再発防止の考え方は
   * `resolveLinkChannelSecret` の doc を読むこと。 */
  const channelSecret = resolveLinkChannelSecret();
  if (!channelId || !channelSecret) {
    return fail(returnTo, "LINE_LIFF_CHANNEL_ID / _SECRET not configured");
  }

  const syncSecret = process.env.SYNC_API_SECRET;
  if (!syncSecret) {
    /* fail-closed。秘密が無ければ cx-agent は 401 を返すので、無駄打ちもしない。 */
    return fail(returnTo, "SYNC_API_SECRET not set; cannot link");
  }

  let idToken: string | undefined;
  try {
    const tokenRes = await phase("token", () =>
      fetch(`${lineApiBaseUrl()}/oauth2/v2.1/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          /* 認可時と **完全一致**の redirect_uri でなければ LINE は交換を拒む。
           * 両方 `getBaseUrl(request)` から作ることで、apex / www の食い違いを生まない。 */
          redirect_uri: `${getBaseUrl(request)}/api/user/line-link/callback`,
          client_id: channelId,
          client_secret: channelSecret,
        }),
      }),
    );
    if (!tokenRes.ok) {
      /* ステータスコードだけでは「なぜ落ちたか」が分からない。LINE は 400 に
       * `error` / `error_description` を載せてくるので、その 2 つだけを読む
       * (`invalid_grant` = redirect_uri 不一致 / code 期限切れ、`invalid_client`
       *  = client_id と secret の組み合わせ違い、等)。**本文全体は出さない** —
       * 交換に成功していれば access_token / id_token が同じ JSON に入るため、
       * 丸ごとログに流すと秘密をログに置くことになる。
       *
       * Response の本文は 1 度しか読めないので、先にテキストで受けてから
       * 分類と説明文の両方に使う。 */
      const errBody = await tokenRes.text();
      const { kind, code } = classifyTokenExchangeError(tokenRes.status, errBody);
      if (kind === "misconfigured-channel") {
        /* 設定破壊は「連携できなかった 1 件」ではなく「全員が連携できない」。
         * ログ保持 (Hobby プランで 1 時間) を越えても残るよう Sentry に上げる。 */
        reportMisconfiguredChannel({
          source: "line-link-callback",
          channel: "link",
          code,
        });
      }
      return fail(returnTo, `token exchange failed: ${tokenRes.status} ${describeLineError(errBody)}`);
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    idToken = tokens.id_token;
  } catch (err) {
    return fail(returnTo, `token exchange threw: ${String(err)}`);
  }

  if (!idToken) return fail(returnTo, "no id_token in token response");
  const issuedIdToken = idToken;

  /* LINE 自身に検証させて `sub` を得る。ブラウザ経由で来た値は何一つ信じない。
   *
   * `expectedNonce` を渡すことで、検証は「LINE が署名した有効なトークンか」から
   * 「**この認可要求で発行された**トークンか」に上がる（D11）。state が守るのは応答の
   * 宛先だけで、id_token そのものの出所は nonce でしか縛れない。 */
  const verified = await phase("verify", () =>
    verifyLineIdToken(issuedIdToken, channelId, { expectedNonce }),
  );
  if (!verified.ok) {
    return fail(returnTo, `id_token verification failed: ${verified.reason}`);
  }

  try {
    const upstream = await phase("ledger", () =>
      fetch(`${CX_AGENT_BASE_URL}/api/identity/link-liff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": syncSecret,
        },
        body: JSON.stringify({
          line_messaging_user_id: verified.messagingUserId,
          /* 連携キーの顧客側は **サーバ確定 customerId**。ブラウザ由来の値は使わない。 */
          shopify_customer_id: auth.customerId,
          shopify_email: verified.email,
        }),
      }),
    );
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      /* 409 = このメールアドレスには既に別の LINE が連携済み（1 対 1 固定・J-4）。
         **恒久的な衝突であって障害ではない。** `error` に丸めると画面が
         「時間をおいてもう一度」と案内し、永久に成功しない再試行を促すことになる。 */
      if (upstream.status === 409) {
        console.warn("[line-link/callback] shopify customer already linked to another LINE");
        return NextResponse.redirect(
          new URL(returnUrlWithResult(returnTo, "conflict"), requestOrigin),
        );
      }
      return fail(returnTo, `cx-agent returned ${upstream.status}: ${detail}`);
    }
  } catch (err) {
    return fail(returnTo, `cx-agent unreachable: ${String(err)}`);
  }

  /* 台帳に行が立った。**同じ流れの中で**データも合体させる。
   *
   * ここが無かったせいで、この経路で連携したお客さまは連携した瞬間に
   * お気に入りが消えたように見えていた（PR #100 の B3）。台帳の行が立つと
   * `resolveIdentity` は LINE セッションを顧客の棚に解決するのに、`line:` の棚に
   * 貯めた中身は運ばれないままなので、**どちらのログイン手段からも読めない**
   * 場所に取り残される。連携を成立させることと荷物を運ぶことは 1 つの操作で、
   * 分けて片方だけ行う理由はどこにも無かった。
   *
   * **台帳を引き直さない**（M-2）。この経路は直前に自分で cx-agent へ書き、その
   * 200 を受け取っている。「いま行を立てた直後なので必ず通る」という前提で
   * 引き直していたが、必ず通るなら引く意味が無く、通らないとき（cx-agent が
   * 一時的に不達）は**合体だけが黙って落ちる**。書いた事実を根拠にする。
   *
   * `applyLinkageEstablished` は throw しない。合体が転んでも連携は成立している
   * ので、リダイレクトは成功のまま返す — ここで error に倒すと、実際には
   * 連携できている人に「連携できませんでした」と言うことになる。
   *
   * **合体の完了は待ち切らない**（2026-08-25）。リダイレクトの中身は合体の結果に
   * 依存しない（上記のとおり成功で固定）のに、Firestore への往復をぜんぶ待って
   * いたせいで、その時間がそのまま白画面の長さになっていた。予算内に終われば
   * その場で終わらせ、超えたらレスポンス送出後に continue する。判断の理由と
   * 途中離脱時の安全性は `lib/auth/linkage-merge-handoff.ts` に書いてある。 */
  const mergeState = await phase("merge", () =>
    applyLinkageEstablishedWithinBudget({
      lineUserId: verified.messagingUserId,
      shopifyCustomerId: auth.customerId,
      source: "line-link-callback",
    }),
  );

  /* 成功したときも 1 行だけ残す。**識別子は載せない**（段の名前と ms だけ）。
     これが無かったせいで「遅い」の内訳を本番から取れなかった。 */
  console.info(
    `[line-link/callback] linked (total=${Date.now() - startedAt}ms ${timings()} mergeState=${mergeState})`,
  );

  clearState();
  return NextResponse.redirect(new URL(returnUrlWithResult(returnTo, "success"), requestOrigin));
}

/**
 * LINE のエラーレスポンスから `error` / `error_description` だけを取り出す。
 *
 * 許可リスト方式なのは意図的。本文をそのまま文字列化すると、将来 LINE が返す
 * フィールドが増えたときに何がログに出るかを此処で制御できなくなる。抽出できな
 * ければ `(no error body)` を返し、ログの行そのものは必ず出す（「静かに失敗した」
 * を作らない）。
 */
function describeLineError(rawBody: string): string {
  try {
    const body = JSON.parse(rawBody) as unknown;
    if (!body || typeof body !== "object") return "(no error body)";
    const record = body as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.error === "string") parts.push(`error=${record.error}`);
    if (typeof record.error_description === "string") {
      parts.push(`error_description=${record.error_description}`);
    }
    return parts.length > 0 ? parts.join(" ") : "(no error body)";
  } catch {
    return "(unparseable error body)";
  }
}

/** 失敗時の戻り先を決めるための locale。next-intl の cookie → accept-language → ja。 */
function resolveLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (cookieLocale && /^[a-z]{2}$/.test(cookieLocale)) return cookieLocale;
  return request.headers.get("accept-language")?.startsWith("en") ? "en" : "ja";
}
