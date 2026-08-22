import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireAuth } from "@/lib/firebase/auth-guard";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { getBaseUrl, getRequestHostname, isTrustedAuthHost } from "@/lib/base-url";
import { getCookieSpec, isSecure, resolveCookieDomain } from "@/lib/auth/cookies";
import { fetchLineLinkageStatus } from "@/lib/line/linkage-status";
import {
  LINE_LINK_STATE_COOKIE,
  STATE_TTL_MS,
  defaultReturnTo,
  resolveLinkChannelId,
  resolveLinkChannelSecret,
  sanitizeReturnTo,
  sealLinkState,
} from "@/lib/line/link-flow";

/**
 * POST /api/user/line-link/init — Web 発 LINE 連携の開始（P2）。
 *
 * ## この endpoint が存在する理由（消す前に読むこと）
 *
 * これは `/api/line-login/init` の連携版であり、**別物**である。同じに見えて 2 点違う:
 *
 *   1. **チャネルが違う**。ログインは `AUTH_LINE_ID`、連携は `LINE_LIFF_CHANNEL_ID`。
 *      LINE の userId は **プロバイダー単位**でしか一意でないため、本番公式アカウント
 *      (Messaging API チャネル) と別プロバイダーのチャネルで認可を取ると、得られる userId は
 *      トークの相手を指さない。それで連携行を作っても Bot からは永久に届かない。
 *      よって連携は必ず LIFF と同じ Login チャネル（= 本番 OA と同一プロバイダー）を使う。
 *      ここを `AUTH_LINE_ID` に「揃える」変更は、動くように見えて連携を無意味にする。
 *   2. **ログイン必須**。連携は「今ログインしている顧客」と不可分なので、開始時点で
 *      Shopify セッションが要る。ログインは当然その逆で、未ログインから始まる。
 *
 * ## なぜ POST で authUrl を返すのか（302 ではなく）
 *
 * スマホで access.line.me のメール/QR 画面を出さずに LINE アプリへ渡すには、LINE の
 * 「自動ログイン」に乗る必要があり、それは **ユーザーの実 `<a>` タップ**でしか発火しない。
 * 自前 URL からの 302 では Chrome iOS が Universal Link を無視する。よってサーバは
 * 認可 URL を組み立てて返すだけにし、遷移はクライアントの `<a href>` に任せる。
 * 詳しい一次情報は `app/api/line-login/init/route.ts` と `lib/line/auto-login.ts`。
 *
 * ## 応答
 *   200 { authUrl }                 … この URL を `<a>` で開く
 *   200 { alreadyLinked: true }     … 既に連携済み。認可へ行かせない（要件 4）
 *   401 { error: "unauthorized" }   … Shopify 未ログイン
 *   503 { error }                   … このデプロイでは連携できない（設定なし / ホスト未登録）
 */
export async function POST(request: NextRequest) {
  /* 自ホスト以外では発行しない。preview から始めた連携が本番 origin の callback に
   * 戻ってしまう事故を防ぐ（`/api/line-login/init` と同じ理由・同じ判定）。 */
  const hostname = getRequestHostname(request);
  if (!isTrustedAuthHost(hostname)) {
    return NextResponse.json(
      { error: "auth_host_not_registered", host: hostname },
      { status: 503 },
    );
  }

  /* 顧客 ID は **サーバ確定セッション由来のみ**。ボディやクエリからは受けない
   * （受けられる形にした瞬間、他人のアカウントに連携を仕掛けられる）。 */
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
  if (limited) return limited;

  const channelId = resolveLinkChannelId();
  /* secret は LINE_LIFF_CHANNEL_SECRET を優先し、未設定なら既存の LINE_LOGIN_CHANNEL_SECRET に
   * フォールバックする。LINE_LIFF_CHANNEL_ID と LINE_LOGIN_CHANNEL_ID は同一 Login チャネル
   * (2009473839) を指すため両 secret は同値。どちらか一方でも設定済みなら「設定済み」と判定する
   * （本番 Vercel に新規シークレットを追加せず既存 env で連携導線を開くため）。
   *
   * 両方とも **必ず trim を通して読む**。env に紛れ込んだ末尾改行が client_secret に載ると
   * LINE は `invalid_client` で交換を拒み、連携は callback まで来て必ず落ちる
   * （2026-08-22 本番障害）。詳細は `resolveLinkChannelSecret` の doc。 */
  const channelSecret = resolveLinkChannelSecret();
  if (!channelId || !channelSecret) {
    /* 503（500 ではない）。壊れているのではなく、このデプロイに連携の資格情報が無いだけ。
     * secret まで見るのは、init だけ通って callback で必ず失敗する状態を作らないため
     * （押せるのに絶対に完了しないボタンは、出さないほうがましである）。 */
    return NextResponse.json({ error: "link_not_configured" }, { status: 503 });
  }

  /* 既連携なら認可に行かせない（要件 4）。
   *
   * 旧 LIFF 導線は、連携済みでも毎回「連携完了」画面を出していた。同じことを繰り返さない。
   * 状態が読めない（linked === null）ときは **通す**。読めないことを理由に連携導線を
   * 塞ぐと、本当に未連携の人が詰む。連携 upsert は冪等なので二重実行は壊れない。 */
  const status = await fetchLineLinkageStatus(auth.customerId);
  if (status.linked === true) {
    return NextResponse.json({ alreadyLinked: true });
  }

  const locale = resolveLocale(request);
  const returnTo = sanitizeReturnTo(
    request.nextUrl.searchParams.get("return_to"),
    defaultReturnTo(locale),
  );

  const { state, nonce, cookieValue } = sealLinkState({
    customerId: auth.customerId,
    returnTo,
  });

  /* cookie の Domain は **リクエスト由来**（`resolveCookieDomain`）。init が apex に来て
   * callback が www に返る（またはその逆）ことがあり、host-only だと state を見失う。
   * これは本番で「セッションの有効期限が切れました」として観測済みの罠。 */
  const spec = getCookieSpec(LINE_LINK_STATE_COOKIE)!;
  const cookieDomain = resolveCookieDomain(request);
  const cookieStore = await cookies();
  cookieStore.set(LINE_LINK_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isSecure(spec),
    sameSite: "lax",
    maxAge: STATE_TTL_MS / 1000,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const baseUrl = getBaseUrl(request);

  /* scope に `email` を入れない。
   *
   * 連携に要るのは Messaging userId（id_token の `sub`）だけで、メールは cx-agent 側でも
   * 任意（LIFF 経路でも null が来うる）。一方 `email` は LINE の申請が通っているチャネルで
   * しか要求できず、未承認のチャネルに投げると **認可そのものが失敗する**。得るものが
   * 無いのに全体を落としうる要求はしない。 */
  /* `nonce` は state と**別の値**を送る（D11）。state は認可応答をこのブラウザに束縛し、
   * nonce は戻ってきた id_token をこの認可要求に束縛する。同じ値を使い回すと、URL に出た
   * state を見た者が nonce も知ることになり、id_token 側の束縛が名ばかりになる。
   * 検証は callback の `verifyLiffIdToken({ expectedNonce })`。 */
  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: `${baseUrl}/api/user/line-link/callback`,
    state,
    nonce,
    scope: "profile openid",
  });

  /* `prompt` も `disable_auto_login` も送らない。どちらも LINE の自動ログインを殺し、
   * 自動ログインは電話で LINE アプリが開く唯一の経路である（`lib/line/auto-login.ts`）。 */
  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.json({ authUrl });
}

/** 復帰先の既定値に使う locale。next-intl の cookie → accept-language → ja。 */
function resolveLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (cookieLocale && /^[a-z]{2}$/.test(cookieLocale)) return cookieLocale;
  return request.headers.get("accept-language")?.startsWith("en") ? "en" : "ja";
}
