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
  if (!cookieString) return false;
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .some((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return false;
      return part.slice(0, eq) === "shop_auth" && part.slice(eq + 1) === "1";
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
  /** ログイン中か (cookie 由来)。 */
  signedIn: boolean;
  /** verify 済み Shopify 顧客 ID。未ログイン / 未解決なら null。 */
  customerId: string | null;
};

/**
 * 作り置きの鍵。**会話 ID・ログイン状態・本人の指紋** の 3 つで決まる。
 *
 * 3 つとも鍵に要る:
 *   - 会話 ID … 別の会話の履歴を混ぜない
 *   - ログイン状態 … ログイン前後で見えてよい履歴が変わる
 *   - 本人の指紋 … 同じ端末で人が入れ替わったときに取り違えない
 */
export function historyCacheKey({ sessionId, signedIn, customerId }: HistoryIdentity): string {
  const who = customerId ? fingerprintIdentity(customerId) : signedIn ? "auth" : "anon";
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
