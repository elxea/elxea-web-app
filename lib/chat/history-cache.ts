/**
 * チャット履歴の作り置き (タブ内キャッシュ) の鍵と読み書き。
 *
 * ## なぜ置くのか
 *
 * 会話履歴は cx-agent への往復で実測 1.6〜2.9 秒かかり、これがページを開くたびに
 * 1 本ずつ出ていた。履歴はチャットを開くまで一切見えないので、見えないものの
 * ために最初の描画と帯域を奪っていた (体感品質監査 #6 / 2026-08-25)。
 *
 * ## なぜ鍵に「誰の履歴か」を入れるのか (QA 指摘 / 2026-08-26)
 *
 * 最初の実装は鍵が `{sessionId}:{ログイン中か}` だけだった。これだと
 * **共用端末で同じタブのままアカウントを切り替えた**とき、
 *
 *   1. A がログイン中に履歴を引き、作り置きができる (鍵の末尾は "1")
 *   2. A がログアウトする — サーバの cookie は消えるが、ブラウザの
 *      `localStorage` の会話 ID と `sessionStorage` の作り置きは残る
 *   3. 5 分以内に B が同じタブでログインする — 会話 ID は据え置き、
 *      ログイン中フラグも "1" に戻るので **鍵が完全に一致する**
 *   4. B の画面に A のクロスチャネル履歴が出る
 *
 * という取り違えが起こりうる。ログイン状態は「ログインしているか」しか語らず、
 * 「誰として」を語らないので、鍵の identity としては不足していた。
 *
 * 対策は 2 段構え (どちらか一方でも塞がるが、片方が効かない状況を想定して両方置く):
 *
 *   - **鍵に本人の指紋を混ぜる** — verify 済み顧客 ID をそのまま鍵に書かず、
 *     ハッシュにして混ぜる。別人になれば鍵が変わるので、上の 3 で一致しない。
 *   - **ログイン状態が変わったら作り置きを全部捨て、会話 ID を振り直す**
 *     (`ChatProvider` 側)。これは 2 の時点で断ち切るので、TTL の残りに依存しない。
 *
 * 顧客 ID を生で置かないのは、ブラウザの保存領域に識別子を平文で残さないため。
 * ハッシュは秘匿目的ではなく **鍵を分けるための指紋** なので、暗号強度は要らない
 * (衝突しにくく安定して速いことだけが要件)。
 */

import { COOKIE_NAME } from "@/lib/auth/cookie-names";

/** 作り置きの鍵の接頭辞。全消しのときの走査にも使う。 */
export const HISTORY_CACHE_PREFIX = "elxea-chat-history:";

/** 作り置きの寿命。これを過ぎたら引き直す。 */
export const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * cookie 文字列から `shop_auth=1` を **完全一致で** 判定する。
 *
 * 以前は `document.cookie.includes("shop_auth=1")` だった。これは部分一致なので、
 * `xshop_auth=1` や `shop_auth=10` のような別名 / 別値の cookie でも真になる。
 * 実害が出る配置は今のところ無いが、認証状態の判定を部分一致に委ねる形は残さない。
 */
export function isSignedInFromCookie(cookieString: string | undefined | null): boolean {
  return hasFlagCookie(cookieString, COOKIE_NAME.shopAuthFlag);
}

/**
 * LINE だけで入っている人か。`line_auth=1` を **完全一致で** 判定する。
 *
 * ## なぜ別に要るのか (QA 指摘 2026-08-25)
 *
 * `isSignedInFromCookie` は Shopify の旗しか見ない。これは「Shopify 顧客 ID が
 * 解決できるはずか」を答える関数なので、それ自体は正しい。問題は
 * **`ChatProvider` の入れ替わり検知までこの 1 つの真偽値に乗っていた**こと。
 *
 * LINE だけで入った人は `shop_auth` が付かないので、
 *
 *   A が LINE でログイン → `signedIn = false`
 *   A がログアウト       → `signedIn = false`  (変化なし)
 *   B が LINE でログイン → `signedIn = false`  (変化なし)
 *
 * となり、**入れ替わりが一度も観測されない**。作り置きも会話 ID もそのままなので、
 * 共用端末で B の画面に A の履歴が出うる — Shopify 側で塞いだはずの取り違えが、
 * LINE だけの人には効いていなかった。
 */
export function hasLineAuthFromCookie(cookieString: string | undefined | null): boolean {
  return hasFlagCookie(cookieString, COOKIE_NAME.lineAuth);
}

/**
 * いま**どの入口で**入っているかの署名。`s` = Shopify / `l` = LINE。
 *
 * 入れ替わりの検知はこの署名の変化で行う。真偽値 1 つではなく署名にするのは、
 * 入口が 2 つあるうえに **両方立つ (連携済み) 状態がある**ため。
 * `"" → "l" → "" → "l"` のような LINE だけの往復も、`"sl" → "s"` のような
 * 連携解除も、同じ 1 本の比較で捕まる。
 */
export function authSignatureFromCookie(cookieString: string | undefined | null): string {
  return (
    (isSignedInFromCookie(cookieString) ? "s" : "") +
    (hasLineAuthFromCookie(cookieString) ? "l" : "")
  );
}

/** `name=1` の旗 cookie を完全一致で探す (部分一致に認証判定を委ねない)。 */
function hasFlagCookie(cookieString: string | undefined | null, name: string): boolean {
  if (!cookieString) return false;
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .some((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return false;
      return part.slice(0, eq) === name && part.slice(eq + 1) === "1";
    });
}

/**
 * 識別子の指紋。FNV-1a 32bit を 36 進で出す。
 *
 * 秘匿ではなく鍵の分離が目的 (上のヘッダ参照)。同じ入力からは必ず同じ値が出て、
 * 別人なら別の値になればよい。
 */
export function fingerprintIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export type HistoryIdentity = {
  /** localStorage の会話 ID。 */
  sessionId: string;
  /** Shopify でログイン中か (cookie 由来)。 */
  signedIn: boolean;
  /** verify 済み Shopify 顧客 ID。未ログイン / 未解決なら null。 */
  customerId: string | null;
  /** LINE の旗 cookie があるか。Shopify 側が立っていなくても真になりうる。 */
  lineAuthed?: boolean;
  /** Auth.js セッション由来の LINE ユーザー ID。未解決なら null。 */
  lineUserId?: string | null;
};

/**
 * 作り置きの鍵。**会話 ID・ログイン状態・本人の指紋** の 3 つで決まる。
 *
 * 3 つとも鍵に要る:
 *   - 会話 ID … 別の会話の履歴を混ぜない
 *   - ログイン状態 … ログイン前後で見えてよい履歴が変わる
 *   - 本人の指紋 … 同じ端末で人が入れ替わったときに取り違えない
 *
 * ## 指紋が「Shopify 顧客 ID だけ」では足りない (QA 指摘 2026-08-25)
 *
 * LINE だけで入った人には Shopify 顧客 ID が無いので、以前はその全員が
 * 未ログインと同じ `anon` の棚に入っていた。同じタブで LINE をログアウトして
 * 再読み込みすると、旗も顧客 ID も無い匿名の状態と **鍵が完全に一致する** ため、
 * 直前の人の履歴がそのまま出うる (再読み込みだと入れ替わり検知も走らない —
 * 比べる相手が無いので初回観測になる)。
 *
 * よって指紋は「解決している方の本人 ID」を使い、どちらも未解決のときだけ
 * 入口の種類 (`auth` / `line` / `anon`) に落とす。入口の種類が違えば鍵も違うので、
 * 少なくとも **LINE の人と匿名の人が同じ棚を共有することは無くなる**。
 */
export function historyCacheKey({
  sessionId,
  signedIn,
  customerId,
  lineAuthed = false,
  lineUserId = null,
}: HistoryIdentity): string {
  const who = customerId
    ? fingerprintIdentity(customerId)
    : lineUserId
      ? fingerprintIdentity(lineUserId)
      : signedIn
        ? "auth"
        : lineAuthed
          ? "line"
          : "anon";
  return `${HISTORY_CACHE_PREFIX}${sessionId}:${signedIn ? "1" : "0"}:${who}`;
}

type CachedEnvelope<T> = { at: number; data: T };

/** 期限内の作り置きを返す。無い / 壊れている / 期限切れなら null。 */
export function readCachedHistory<T>(
  storage: Storage,
  identity: HistoryIdentity,
  now: number = Date.now(),
): T | null {
  try {
    const raw = storage.getItem(historyCacheKey(identity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEnvelope<T>;
    if (!parsed?.data || typeof parsed.at !== "number") return null;
    if (now - parsed.at > HISTORY_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** 作り置きを書く。容量超過・プライベートモード等で失敗しても機能は落とさない。 */
export function writeCachedHistory<T>(
  storage: Storage,
  identity: HistoryIdentity,
  data: T,
  now: number = Date.now(),
): void {
  try {
    storage.setItem(historyCacheKey(identity), JSON.stringify({ at: now, data }));
  } catch {
    // 作り置きが無いだけで機能は落ちない。
  }
}

/**
 * 作り置きを **全部** 捨てる。
 *
 * ログイン状態が変わったときに呼ぶ。1 件だけ消すのでは足りない — 鍵は会話 ID と
 * 本人の指紋で分かれているので、前の人の分は別の鍵で残っているため。
 */
export function clearAllHistoryCache(storage: Storage): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(HISTORY_CACHE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // 消せなくても TTL で失効する。
  }
}
