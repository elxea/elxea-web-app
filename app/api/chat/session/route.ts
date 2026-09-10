/**
 * GET /api/chat/session — チャットの会話 ID を**サーバから受け取る**唯一の口。
 *
 * ブラウザはもう会話 ID を自分で作らない。ここが `chat_sid` cookie
 * (httpOnly / 署名付き) を発行し、画面には bare UUID だけを返す。
 *
 * ## 署名 (`session_proof`) をブラウザに返さないのはなぜか
 *
 * 署名は「この会話 ID はサーバが発行した」という証明で、cx-agent への転送時に
 * **サーバ同士のあいだだけ**で使う。画面に渡すと、それを見た人が別のブラウザから
 * 同じ会話になりすませてしまい、httpOnly cookie にした意味が消える。画面が要るのは
 * 履歴の作り置きの鍵に使う ID だけなので、返すのはそれだけにする。
 *
 * ## `?rotate=1`
 *
 * ログイン状態が変わったとき（＝端末の前にいる人が入れ替わりうるとき）に、画面から
 * 明示的に振り直す。cookie を消して回るのではなく新しい会話を発行して上書きする形に
 * してあるのは、消すだけだと次の 1 通が届くまで会話が無い状態になり、その間の
 * 履歴取得が空振りするため。
 */
import { NextRequest, NextResponse } from "next/server";

import { resolveChatSession, writeChatSessionCookie } from "@/lib/chat/session-server";

/* cookies() を読んで cookie を発行するので動的レンダリング固定。
   ランタイム指定は書かない（Route Handler の既定が nodejs）。 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rotate = request.nextUrl.searchParams.get("rotate") === "1";
  const session = await resolveChatSession({ rotate });

  const response = NextResponse.json(
    { session_id: session.sessionId },
    {
      /* 会話 ID は人ごとに違う。どこかに載ると別の人に同じ ID が配られる。 */
      headers: { "Cache-Control": "no-store" },
    },
  );

  if (session.minted) writeChatSessionCookie(response, session);
  return response;
}
