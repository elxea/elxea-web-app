/**
 * 進行中の Shopify OAuth（メールログイン）を **複数同時に** 覚えておくための入れ物。
 *
 * なぜ必要か（2026-08-25 の障害の直接原因のひとつ）:
 *   これまで PKCE の `code_verifier` と CSRF 用の `state` は、それぞれ
 *   `shop_cv` / `shop_state` という **1 個しかないクッキー** に入れていた。
 *   つまり「ログイン開始」を 2 回踏むと、2 回目が 1 回目の値を上書きする。
 *
 *   メール（ワンタイムコード）ログインは
 *     ログイン開始 → メールを見に行く → 戻ってコードを入れる
 *   という往復があるため、その間にユーザーがもう一度ログインボタンを押す・
 *   別タブを開く・ブラウザが同じリンクを二重に叩く、といったことが普通に起きる。
 *   実際に本番ログでは `/api/auth/login` が **1.23 秒差で 2 回** 記録されている
 *   (2026-08-25 21:51:14.522 / 21:51:15.753 JST)。
 *
 *   上書きが起きると、ユーザーが実際に完了した認証の `state` と、クッキーに
 *   残っている `state` が食い違い、callback は `invalid_state` として弾く。
 *   ところが Shopify 側のログインは成立しているので、直後の再試行では即座に
 *   ログインが通る。これが「エラーが出たのに実はログインできている」の正体。
 *
 * 設計:
 *   - `state` をキーに、進行中の認証を最大 {@link PENDING_AUTH_MAX} 件まで保持する。
 *   - 期限切れ（{@link PENDING_AUTH_TTL_MS}）は読み出し時に捨てる。
 *   - 1 件ごとに locale と returnTo も持たせる。これも従来は単一クッキーだったため、
 *     戻り先の異なるログインが同時に走ると戻り先が入れ替わる潜在バグがあった。
 *   - 使い終わった（token 交換に成功した）エントリは取り除く = 使い捨て。
 *
 * 秘密の扱い:
 *   `code_verifier` は PKCE の一時値で、httpOnly + Secure + SameSite=Lax の
 *   クッキーに入る（従来の `shop_cv` と同じ保護レベル）。ログには出さない。
 */

/** 進行中の認証をまとめて入れるクッキー名。 */
export const PENDING_AUTH_COOKIE = "shop_oauth";

/** 1 回のログイン試行を覚えておく時間（従来の shop_cv と同じ 10 分）。 */
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

/** 同時に覚えておける試行数。古いものから捨てる。 */
export const PENDING_AUTH_MAX = 5;

/**
 * クッキー値の上限（バイト）。ブラウザの 4KB 制限に対する安全側の値。
 * これを超えるときは古い試行から捨てて収める。
 */
const MAX_SERIALIZED_LENGTH = 3000;

export type PendingAuth = {
  /** 認可リクエストに載せた state（CSRF 対策 + 突合キー）。 */
  state: string;
  /** PKCE の code_verifier。 */
  verifier: string;
  /** id_token を「この試行」に結びつける nonce（callback が突き合わせる）。 */
  nonce: string;
  /** ログイン後に戻す言語。 */
  locale: string;
  /** ログイン後の戻り先（サニタイズ済みの相対パス）。無ければ null。 */
  returnTo: string | null;
  /** 発行時刻（epoch ms）。TTL 判定に使う。 */
  createdAt: number;
};

function isPendingAuth(value: unknown): value is PendingAuth {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    v.state.length > 0 &&
    typeof v.verifier === "string" &&
    v.verifier.length > 0 &&
    typeof v.nonce === "string" &&
    v.nonce.length > 0 &&
    typeof v.locale === "string" &&
    (v.returnTo === null || typeof v.returnTo === "string") &&
    typeof v.createdAt === "number" &&
    Number.isFinite(v.createdAt)
  );
}

/**
 * クッキー値を読み出す。壊れた値・期限切れは黙って捨てる
 * （ログインを止める理由にはしない）。
 */
export function parsePendingAuths(
  cookieValue: string | undefined | null,
  now: number = Date.now(),
): PendingAuth[] {
  if (!cookieValue) return [];
  let decoded: string;
  try {
    decoded = Buffer.from(cookieValue, "base64url").toString("utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isPendingAuth)
    .filter((entry) => now - entry.createdAt < PENDING_AUTH_TTL_MS);
}

/** クッキーに入れられる形にする。 */
export function serializePendingAuths(list: PendingAuth[]): string {
  let entries = [...list];
  // 新しいものを優先して、クッキー長に収まるまで古いものから落とす。
  for (;;) {
    const encoded = Buffer.from(JSON.stringify(entries), "utf8").toString("base64url");
    if (encoded.length <= MAX_SERIALIZED_LENGTH || entries.length <= 1) return encoded;
    entries = entries.slice(1);
  }
}

/**
 * 新しい試行を足す。期限切れを掃除し、{@link PENDING_AUTH_MAX} 件を超えたら
 * 古いものから捨てる（配列の末尾がいちばん新しい）。
 */
export function addPendingAuth(
  list: PendingAuth[],
  entry: PendingAuth,
  now: number = Date.now(),
): PendingAuth[] {
  const alive = list
    .filter((e) => now - e.createdAt < PENDING_AUTH_TTL_MS)
    .filter((e) => e.state !== entry.state);
  const next = [...alive, entry];
  return next.slice(Math.max(0, next.length - PENDING_AUTH_MAX));
}

/** state で試行を引く。見つからなければ null。 */
export function findPendingAuth(
  list: PendingAuth[],
  state: string | null | undefined,
): PendingAuth | null {
  if (!state) return null;
  return list.find((entry) => entry.state === state) ?? null;
}

/** 使い終わった試行を取り除く（authorization code の使い回しを防ぐ）。 */
export function removePendingAuth(list: PendingAuth[], state: string): PendingAuth[] {
  return list.filter((entry) => entry.state !== state);
}
