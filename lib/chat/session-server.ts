/**
 * チャットの会話 ID を**サーバが決める**ための唯一の入口 (server only)。
 *
 * ## 契約 (ここを迂回する経路を作らない)
 *
 * チャット系の route handler は、ブラウザが body / クエリで送ってきた `session_id`
 * を **一切読まない**。会話 ID は必ずこの関数が返した値を使う。理由は
 * `lib/chat/session-token.ts` の冒頭にある通りで、UUID は秘密ではないので
 * 「知っていること」を会話の所有権の根拠にできない。
 *
 * これは `lib/chat/proxy.ts` が `shopify_customer_id` に対して既にやっていること
 * (「ブラウザ自己申告は透過しない」) を、`session_id` にも同じ形で広げたもの。
 * 片方だけ守っていた状態が、実際に他人の会話を奪える経路になっていた。
 *
 * ## 返り値
 *
 *   sessionId … cx-agent へ渡す bare UUID (DB の主キーなので形を変えない)
 *   proof     … 署名。`session_proof` として **別フィールド**で転送する
 *   minted    … 今この場で発行したか。true のとき呼び出し側が cookie を書く
 *
 * cookie を「書く」責任を呼び出し側に残しているのは、応答の形が経路ごとに違う
 * (JSON / SSE ストリーム / リダイレクト) ためで、ここで `cookies().set()` を
 * 呼ぶと Server Component からの読み出しと混ざって扱いにくくなる。
 * 書き方自体は下の `writeChatSessionCookie()` 1 本に寄せてある。
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { getCookieSpec, isSecure } from "@/lib/auth/cookies";
import { env } from "@/lib/config";
import { logger } from "@/lib/log";
import { randomId } from "@/lib/random-id";
import {
  isBareSessionId,
  parseSessionToken,
  sessionCookieValue,
  signSessionId,
} from "@/lib/chat/session-token";

/** 会話の寿命 (秒)。Shopify / LINE のセッション cookie と揃えて 30 日。 */
export const CHAT_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export interface ChatSession {
  /** cx-agent へ渡す bare UUID。 */
  sessionId: string;
  /** 署名。`CHAT_SESSION_SECRET` 未設定のときだけ null (= 未署名)。 */
  proof: string | null;
  /** この応答で新しく発行したか (true なら cookie を書く)。 */
  minted: boolean;
}

export interface ResolveChatSessionOptions {
  /** 既存の cookie を無視して必ず振り直す (ログイン状態が変わったとき)。 */
  rotate?: boolean;
}

/**
 * cookie を検証して会話 ID を決める。無効・不在なら新しく発行する。
 *
 * ## `CHAT_SESSION_SECRET` が未設定のとき
 *
 * 署名を作れないので `proof: null` の **未署名** で通す。cx-agent 側は未署名の
 * session を identity として扱わないので、そこで安全側に落ちる。
 *
 * 未署名のときだけ cookie の中身を bare UUID として読み戻すのは、ここで毎回
 * 新しい ID を作ると **1 発言ごとに別の会話になり、手元と Ring 2 のチャットが
 * 事実上使えなくなる**ため。この状態の危険度は「この変更を入れる前」と同じで、
 * それより悪くはならない。本番でここに入るのは設定漏れなので `logger.error` で
 * 必ず 1 行残す (無言で劣化させない = 憲章 R1)。
 */
export async function resolveChatSession(
  options: ResolveChatSessionOptions = {},
): Promise<ChatSession> {
  const secret = env("CHAT_SESSION_SECRET");
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME.chatSession)?.value;

  if (!secret) {
    logger.error(
      "chat.session.secret-missing",
      new Error("CHAT_SESSION_SECRET is not set; chat sessions are unsigned"),
      {
        operation: "resolveChatSession",
        /* 値は出さない (未設定であることだけが情報)。cx-agent 側は未署名を
           identity として扱わないので、会話は匿名のまま進む。 */
        consequence: "chat sessions are not bound to this server",
      },
    );
    if (!options.rotate && isBareSessionId(raw)) {
      return { sessionId: raw, proof: null, minted: false };
    }
    return { sessionId: randomId(), proof: null, minted: true };
  }

  if (!options.rotate) {
    const parsed = parseSessionToken(raw, secret);
    if (parsed) {
      return { sessionId: parsed.sessionId, proof: parsed.proof, minted: false };
    }
  }

  /* ここに来るのは「cookie が無い」「形が違う」「署名が合わない」「振り直し指示」の
     いずれか。どれも**新しい会話を始める**が答えで、送られてきた中身は使わない。 */
  const sessionId = randomId();
  return { sessionId, proof: signSessionId(sessionId, secret), minted: true };
}

/**
 * 発行したばかりの会話 ID を応答に載せる。
 *
 * 署名済みなら `<uuid>.<sig>`、未署名運用なら bare UUID を入れる。属性は
 * レジストリ (`lib/auth/cookie-names.ts`) の `chat_sid` の規則に従う —
 * `secure` を直書きすると平文 http の環境でブラウザに黙って捨てられる。
 */
export function writeChatSessionCookie(
  response: NextResponse,
  session: ChatSession,
): void {
  response.cookies.set(
    COOKIE_NAME.chatSession,
    sessionCookieValue(session.sessionId, session.proof),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isSecure(getCookieSpec(COOKIE_NAME.chatSession)!),
      maxAge: CHAT_SESSION_MAX_AGE,
    },
  );
}
