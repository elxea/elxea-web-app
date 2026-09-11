/**
 * 会話 ID を、外部 (Hume) に渡してよい「意味のない文字列」に不可逆変換する。
 *
 * 正本: 設計書 D-4 / 決定 #7
 * https://app.notion.com/p/3d870c9d064c81798c41cd5135be44f0
 *
 * ## なぜ変換するのか
 *
 * 音声はブラウザと Hume のあいだを直接流れるので、会話を一本に保つための
 * 識別子は **ブラウザの手を経由して Hume に渡る**。そこへ会話 ID の生の値や
 * 顧客 ID を載せると、
 *
 *   - Hume 側のダッシュボード・ログ・保存データに elxea の一次識別子が残る
 *   - ブラウザの開発者ツールから会話 ID がそのまま読める
 *
 * の 2 つが同時に起きる。会話 ID は `app/api/chat/session/route.ts` が
 * httpOnly cookie に閉じ込めている値で (「他人の会話 ID を知っているだけで
 * 読み書きできた」穴を塞いだ経緯がある)、それを自分で外へ出しては意味がない。
 *
 * そこで **鍵を持つ者だけが元に戻せる形** ではなく、**誰も元に戻せない形**
 * (HMAC) にする。逆引きは「変換後 → 元の会話」の対応表を持っている側
 * (接客エージェント) だけができる。
 *
 * ## 接客エージェント側との契約 (本タスクでは実装しない)
 *
 * 生成される文字列の形はこの 1 行が正本:
 *
 * ```
 *   handle = "v1:" + base64url( HMAC-SHA256( VOICE_SESSION_SECRET,
 *                                            "roji-voice-session:v1:" + sessionId ) )
 * ```
 *
 *   - `sessionId` は `resolveChatSession()` が返す bare UUID (cx-agent の主キー)
 *   - 出力は常に `v1:` + base64url 43 文字 = 全長 46 文字。`=` パディングは無い
 *   - 同じ鍵・同じ `sessionId` なら常に同じ文字列 (決定的)。会話が続くあいだ
 *     ブラウザが何度入場券を取り直しても同じ handle になる
 *   - **一方向**。handle から `sessionId` は復元できない
 *
 * したがって接客エージェント側がやることは 1 つだけ:
 *
 *   - 入場券の発行時に web app 側から渡される `(handle, sessionId)` の対応を
 *     **短期間だけ**保持し、Hume から handle 付きの発話が届いたときに
 *     `sessionId` を引き当てて **同じ会話に**書く
 *
 * 対応表を作れるのは鍵を持つ web app 側だけなので、cx-agent が独自に handle を
 * 計算し直す必要はない (鍵を 2 箇所に配らない)。
 *
 * ## 鍵を `CHAT_SESSION_SECRET` と共用しない理由
 *
 * 共用すると、同じ `sessionId` に対する「cookie の署名」と「Hume に渡す handle」が
 * 同じ鍵から出る。片方が漏れたときに両方の前提が崩れるし、将来どちらかの
 * 生成規則を変えたいときに他方を巻き込む。鍵を分け、さらに下の
 * `DOMAIN_SEPARATOR` で入力側にも別々のラベルを付けて、**鍵が仮に同値でも
 * 出力が衝突しない**ようにしてある。
 */

import crypto from "crypto";

import { env } from "@/lib/config";

/**
 * handle の版。生成規則を変えるときはここを上げる。
 *
 * 前置しているのは、接客エージェント側が「自分の知らない版が来た」を
 * 形だけで判定でき、黙って別の会話に書かずに済むようにするため。
 */
export const VOICE_SESSION_HANDLE_VERSION = "v1" as const;

/**
 * HMAC の入力に前置するラベル。
 *
 * 同じ鍵が別用途に流用されたとしても、入力空間が重ならないので出力も重ならない
 * (domain separation)。`lib/chat/session-token.ts` はラベルを持たないが、あちらは
 * 用途が 1 つしかない鍵で、こちらは「将来 2 つ目の用途が生えうる」前提で書く。
 */
const DOMAIN_SEPARATOR = `roji-voice-session:${VOICE_SESSION_HANDLE_VERSION}:`;

/** 標準 base64 を base64url に直す (`lib/chat/session-token.ts` と同じ規則)。 */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * `VOICE_SESSION_SECRET` が無いために handle を作れなかった。
 *
 * 呼び出し側 (入場券の発行窓口) はこれを受けて **入場券を出さない**。
 * handle 無しで Hume につなぐと、声で話した分が既存の会話に合流できず、
 * 「文字と声で会話が分裂する」という設計上いちばん避けたい状態になる
 * (設計書 D-4)。無言で劣化させず、必ず落とす。
 */
export class VoiceSessionSecretMissingError extends Error {
  constructor() {
    super(
      "VOICE_SESSION_SECRET is not set; a voice session handle cannot be derived. " +
        "Declared in lib/config/spec.ts — set it in the deployment environment.",
    );
    this.name = "VoiceSessionSecretMissingError";
  }
}

/**
 * 会話 ID から、Hume に渡してよい handle を作る。
 *
 * @param sessionId `resolveChatSession()` が返す bare UUID。
 * @returns `v1:<base64url 43 文字>`
 * @throws {VoiceSessionSecretMissingError} 鍵が未設定のとき。
 *
 * 例外メッセージにも戻り値にも `sessionId` は出さない。ログに落ちた瞬間、
 * 生の会話 ID を外へ出さないという前提が消えるため。
 */
export function deriveVoiceSessionHandle(sessionId: string): string {
  const secret = env("VOICE_SESSION_SECRET");
  if (!secret) throw new VoiceSessionSecretMissingError();

  const digest = crypto
    .createHmac("sha256", secret)
    .update(`${DOMAIN_SEPARATOR}${sessionId}`, "utf8")
    .digest("base64");

  return `${VOICE_SESSION_HANDLE_VERSION}:${toBase64Url(digest)}`;
}

/**
 * 文字列が handle の形をしているか。
 *
 * 接客エージェント側と web app 側の両方が同じ判定を書かずに済むように、
 * 形の定義はこの 1 箇所に置く。中身の正しさ (鍵が合うか) は**判定できない** —
 * 一方向変換なので、それが正しい性質。
 */
export function isVoiceSessionHandle(value: unknown): value is string {
  return typeof value === "string" && /^v1:[A-Za-z0-9_-]{43}$/.test(value);
}
