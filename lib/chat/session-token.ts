/**
 * チャットの会話 ID (`session_id`) に、サーバだけが作れる署名を付ける。
 *
 * ## なぜ要るのか (これを外すと元の穴に戻る)
 *
 * 会話 ID は長らく **ブラウザが localStorage で自分で作った UUID** で、body に
 * そのまま載せて送っていた。サーバは形も出所も一切見ていない。つまり
 * 「他人の会話 ID を知っている」だけで、ログイン済みの攻撃者が
 *
 *   1. 他人の匿名会話を自分の LINE / 顧客に恒久的に結び付ける (本人が締め出される)
 *   2. 他人の Web 会話を履歴 API から読む
 *   3. 他人の会話ストリームに自分の発言を書き込む
 *
 * を全部できた。UUID は秘密ではない — URL・ログ・共用端末の localStorage・
 * 総当たりのどれからでも漏れうる値なので、「知っていること」を根拠にしてはいけない。
 *
 * 処方は **会話 ID をサーバが発行し、サーバしか作れない署名を添えて運ぶ**こと。
 * ブラウザの自己申告は最後まで一切見ない (`lib/chat/session-server.ts`)。
 *
 * ## なぜ署名を `session_id` に混ぜず、別フィールドで運ぶのか
 *
 * cx-agent 側の DB (`conversations.user_id` 等) が **生の UUID をそのまま主キー**に
 * 持っている。`session_id` の形を `uuid.sig` に変えると、既存の会話が全部
 * 別の ID として扱われ迷子になる。よって:
 *
 *   - `session_id`    … 最後まで**ただの bare UUID**
 *   - `session_proof` … 署名。転送時に別フィールド (POST は body / GET はクエリ)
 *   - cookie (`chat_sid`) … ブラウザに預ける入れ物なので `uuid.sig` の 1 本にまとめる
 *
 * ## 書き方は `lib/shopify/webhooks/verify.ts` に倣う
 *
 * HMAC-SHA256 + `crypto.timingSafeEqual`、長さが違うときは比較前に false。
 * `timingSafeEqual` は長さが違うと **throw する** ので、長さ判定を先に置くのは
 * 見た目の丁寧さではなく必須の順序。
 *
 * この module は `node:crypto` を読むので Edge からは使えない。呼び出し側は
 * Route Handler (既定 nodejs runtime) だけなので問題にならない。
 */
import crypto from "node:crypto";

/**
 * v4 UUID の形。`randomId()` (`lib/random-id.ts`) が作る形と同じものを受け付ける。
 *
 * 形を見るのは、**署名が通っても形が壊れた ID を下流に流さない**ため。cx-agent は
 * この値をそのまま DB のキーにするので、こちらが形の門番を持たないと、鍵の運用を
 * 誤った瞬間に任意の文字列が主キーとして流れ込む。
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** cookie に入れるトークンの区切り。UUID にも base64url にも現れない文字を使う。 */
const SEPARATOR = ".";

export interface ParsedSessionToken {
  /** cx-agent へ渡す bare UUID。 */
  sessionId: string;
  /** 同じ UUID に対する署名 (`session_proof` として別フィールドで運ぶ)。 */
  proof: string;
}

/** 標準 base64 を base64url に直す (cookie 値・クエリ値として無加工で運べる形)。 */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 会話 ID に対する署名を作る。
 *
 * 鍵は `trim()` してから使う。`CHAT_SESSION_SECRET` は**新設の鍵**で、これに
 * 由来する発行済みの値がまだ世の中に無いため、貼り付け由来の末尾改行を落としても
 * 何も無効化しない (`SESSION_SECRET` を raw のまま扱っているのとは前提が違う。
 * 経緯は `lib/config/spec.ts` の「正規化方針」)。
 *
 * 鍵が空のときは **投げる**。ここに空鍵で来るのは配線の誤りであって利用者入力の
 * 問題ではなく、空鍵で「それらしい署名」を作ってしまうと検証が素通りになる。
 * 未設定時の落とし方 (未署名で通す) は呼び出し側 `resolveChatSession()` が持つ。
 */
export function signSessionId(sessionId: string, secret: string): string {
  const key = secret.trim();
  if (!key) {
    throw new Error(
      "signSessionId: CHAT_SESSION_SECRET is empty. " +
        "Callers must check the secret before signing (see lib/chat/session-server.ts).",
    );
  }
  return toBase64Url(
    crypto.createHmac("sha256", key).update(sessionId, "utf8").digest("base64"),
  );
}

/** cookie に入れる 1 本の文字列 `<uuid>.<sig>` を組む。 */
export function buildSessionToken(sessionId: string, secret: string): string {
  return `${sessionId}${SEPARATOR}${signSessionId(sessionId, secret)}`;
}

/**
 * cookie の中身を検証して分解する。
 *
 * **fail-closed**: 形が違う / 署名が合わない / 鍵が未設定 のいずれでも `null` を返す。
 * 「読めなかったので中身をそのまま信じる」経路は作らない — それが元の欠陥そのもの。
 */
export function parseSessionToken(
  token: string | undefined | null,
  secret: string | undefined | null,
): ParsedSessionToken | null {
  if (!token || !secret) return null;
  const key = secret.trim();
  if (!key) return null;

  /* 区切りは 1 つだけ。UUID にも base64url にも `.` は現れないので、2 個以上あれば
     こちらが作った形ではない。`split` の結果を長さで見て、先頭 2 つだけ拾う
     ような寛容さを持たせない (寛容さは検証の穴になる)。 */
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;

  const [sessionId, proof] = parts;
  if (!UUID_V4.test(sessionId)) return null;
  if (!proof) return null;

  const expected = Buffer.from(signSessionId(sessionId, key), "utf8");
  const received = Buffer.from(proof, "utf8");
  // 長さ判定が先。`timingSafeEqual` は長さ違いで throw する。
  if (expected.length !== received.length) return null;
  if (!crypto.timingSafeEqual(expected, received)) return null;

  return { sessionId, proof };
}

/** cookie に入れる文字列を、署名の有無に応じて組む (未署名運用では bare UUID)。 */
export function sessionCookieValue(sessionId: string, proof: string | null): string {
  return proof ? `${sessionId}${SEPARATOR}${proof}` : sessionId;
}

/** `randomId()` 由来の bare UUID かどうか (未署名運用の cookie を読み戻すときだけ使う)。 */
export function isBareSessionId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}
