import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getCookieSpec, isSecure, resolveCookieDomain } from "@/lib/auth/cookies";
import {
  LINK_INTENT_COOKIE,
  LINK_INTENT_TTL_MS,
  sealLinkIntent,
} from "@/lib/auth/link-intent";
import { getRequestHostname, isTrustedAuthHost } from "@/lib/base-url";
import { readVerifiedLineUserIdFrom } from "@/lib/line/session";

/**
 * ワンタップ連携の入口（J-1 案A）。
 *
 * `GET /api/user/line-link/intent?locale=ja`
 *   → 意思を封緘して cookie に置き、Shopify のログインへ 302
 *
 * ## 何を直しているか
 *
 * マイページに出ていた「メールアドレスで連携する」は、**押しても定義上 100%
 * 何も起きなかった**。行き先が `/api/auth/login` にハードコードされたただの
 * メールログインで、戻り先（`/api/auth/callback`）は「すでに台帳に行がある人を
 * 確認して合体するだけ」の経路だったからである。連携しようとしている人は当然
 * まだ台帳に行が無いので、`not-linked` を返して何も起きずに終わる。
 *
 * Wave 1 でこの文言は「メールアドレスでログイン」に正された（嘘は消えた）が、
 * ワンタップにはならなかった。ここがその続きにあたる。
 *
 * ## なぜ「意思」を運ぶ必要があるのか
 *
 * 戻ってきた時点では、その人が連携するつもりで出て行ったのかを知る手がかりが
 * 無い。手がかりが無いまま合体させるのが B5 の事故だった（`line_uid` cookie が
 * 同居しているだけを理由に、共用端末の前の人のデータを次の人の棚へ移す）。
 *
 * この route が置く cookie は同居ではなく**意思そのもの**である。押した瞬間に
 * しか作られず、押した人の LINE にしか使えず、一度使えば消える。判定の中身は
 * `lib/auth/link-intent.ts`。
 *
 * ## なぜ GET なのか
 *
 * `<a>` タップからの遷移だから。LINE アプリ内ブラウザを含め、ここは素直に
 * ページ遷移させたい（fetch → 手動リダイレクトにすると、アプリ内ブラウザで
 * 挙動が割れる）。副作用は「自分の cookie を 1 本置く」だけで、他人の状態は
 * 一切変えないので、GET でも安全に置ける。
 *
 * ## LINE セッションが要る
 *
 * 封筒に入れるのは**サーバ確定**の LINE userId のみ。LINE セッションが無い人は
 * そもそもワンタップの対象ではないので、意思を作らずログインへ送る（普通の
 * メールログインとして成立する）。
 */
export const dynamic = "force-dynamic";

/** ロケールは URL に載せ直すので、想定外の値を通さない。 */
function safeLocale(raw: string | null): string {
  return raw === "en" ? "en" : "ja";
}

export async function GET(request: NextRequest) {
  /* 自分のホストでなければ何もしない。`/api/line-login` と同じ理由 —
     別のデプロイへ静かに連れて行くより、断る方がまし。 */
  const hostname = getRequestHostname(request);
  if (!isTrustedAuthHost(hostname)) {
    return NextResponse.json(
      { error: "auth_host_not_registered", host: hostname },
      { status: 503 },
    );
  }

  const locale = safeLocale(request.nextUrl.searchParams.get("locale"));
  const loginUrl = new URL(
    `/api/auth/login?locale=${encodeURIComponent(locale)}`,
    request.nextUrl.origin,
  );
  const response = NextResponse.redirect(loginUrl);

  const cookieStore = await cookies();
  const lineUserId = readVerifiedLineUserIdFrom(cookieStore);
  if (!lineUserId) {
    /* LINE セッションが無い。ワンタップの対象ではないが、**ログインは妨げない** —
       ここで 4xx に倒すと、押した人にとっては「ボタンが壊れている」ようにしか
       見えない。普通のメールログインとして成立させる。 */
    console.warn("[line-link-intent] no LINE session; falling through to plain login");
    return response;
  }

  const sealed = sealLinkIntent(lineUserId);
  if (!sealed) {
    console.error("[line-link-intent] failed to seal intent; falling through to plain login");
    return response;
  }

  const spec = getCookieSpec(LINK_INTENT_COOKIE)!;
  const domain = resolveCookieDomain(request);
  response.cookies.set(LINK_INTENT_COOKIE, sealed, {
    httpOnly: true,
    secure: isSecure(spec),
    /* `lax` で足りる。Shopify から戻ってくるのはトップレベルのナビゲーション
       （GET）なので lax でも送られる。`none` にすると、この cookie が
       あらゆるサードパーティ文脈で飛ぶようになり、意思の窓が不必要に広がる。 */
    sameSite: "lax",
    maxAge: Math.floor(LINK_INTENT_TTL_MS / 1000),
    path: "/",
    ...(domain ? { domain } : {}),
  });

  return response;
}
