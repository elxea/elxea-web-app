/**
 * 記録に載せる前に、載せてはいけないものを落とす（憲章 Wave 3）。
 *
 * ## なぜ記録の側で落とすのか
 *
 * 「呼び出し側が気をつけて詰める」で運用すると、気をつけ忘れた 1 か所が
 * そのまま外部サービス (Sentry) への送信になる。取り消せないので、**規律では
 * なく通り道の側**に置く。`lib/log` を通る限り、呼び出し側が何を詰めても
 * ここを必ず通過する。
 *
 * ## 落とすもの
 *
 * 1. **鍵の名前で落とす** — `email` `phone` `address` `token` `secret` 等。
 *    値を見るまでもなく中身が決まっている場所。
 * 2. **値の形で落とす** — 上流 (Shopify / LINE) のエラーメッセージには、
 *    こちらが詰めていなくてもメールアドレスや ID トークンがそのまま入って
 *    くることがある。文字列は必ず形でも検査する。
 *
 * 落とした跡は `[redacted]` として**残す**。鍵ごと消すと「その項目が無かった」
 * のか「消した」のかが後から分からず、調査のときに嘘をつくことになる。
 */

/** 鍵の名前だけで中身が決まる場所。部分一致で見る。 */
const SENSITIVE_KEY = new RegExp(
  [
    "e?mail",
    "phone",
    "tel",
    "address",
    "postal",
    "zip",
    "token",
    "secret",
    "password",
    "passwd",
    "credential",
    "authorization",
    "cookie",
    "session",
    "signature",
    "nonce",
    "apikey",
    "api_key",
    "dsn",
    "birth",
  ].join("|"),
  "i",
);

/**
 * 人の名前が入る鍵。`name` を部分一致で落とすと `eventName` `operationName`
 * まで消えて調査ができなくなるので、名前らしい鍵だけを名指しする。
 */
const NAME_KEY = /^(first|last|full|display|customer|user|given|family|middle)?_?name$/i;

/** 値の形で見つける。上流のメッセージにそのまま混ざってくる。 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** 日本の電話番号 (ハイフン有無の両方)。 */
const PHONE = /\b0\d{1,4}-?\d{1,4}-?\d{3,4}\b/g;
/** JWT (LINE の id_token / Shopify の access token がこの形で流れてくる)。 */
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
/** 十分に長い不透明文字列 = 資格情報とみなす。 */
const OPAQUE = /\b[A-Za-z0-9_-]{40,}\b/g;

export const REDACTED = "[redacted]";

/** 記録 1 件が膨らみすぎないための上限。深すぎる木は調査の役に立たない。 */
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_STRING = 500;

/**
 * 文字列から、形で分かる秘密を落とす。
 *
 * 鍵の名前で落とせない場所 (例外メッセージ・自由記述) のための最後の網。
 */
export function redactString(value: string): string {
  const trimmed = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  return trimmed
    .replace(JWT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(OPAQUE, REDACTED);
}

/**
 * 記録に載せる値を、載せてよい形に作り替える。
 *
 * 元の値は**変更しない** (呼び出し側の動作を記録が変えてはいけない)。
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return value.toString();

  if (depth >= MAX_DEPTH) return "[depth-limit]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      cause: value.cause === undefined ? undefined : redact(value.cause, depth + 1),
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `[+${value.length - MAX_ARRAY} more]`] : head;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        SENSITIVE_KEY.test(key) || NAME_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }

  return "[unknown]";
}

/**
 * 例外そのものを Sentry に渡すときに、メッセージだけ作り替えた複製を作る。
 *
 * stack はそのまま引き継ぐ (Sentry のまとめ方が stack に依るため)。上流の
 * メッセージに顧客のメールアドレスが入っている実例があるので、メッセージは
 * 必ず通す。
 */
export function redactError(error: Error): Error {
  const safeMessage = redactString(error.message);
  if (safeMessage === error.message) return error;

  const copy = new Error(safeMessage);
  copy.name = error.name;
  copy.stack = error.stack ? redactString(error.stack) : undefined;
  return copy;
}
