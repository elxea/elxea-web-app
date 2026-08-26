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
/** 1 階層あたりの鍵の上限。生のリクエストを丸ごと詰められても膨らませない。 */
const MAX_KEYS = 40;

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

  /* バイト列は**中身を絶対に展開しない**。`Buffer` は `Uint8Array` なので、
     素直に「オブジェクト」として鍵を数え上げると `{0:101,1:121,…}` になり、
     **元のバイト列がそのまま復元できる形で外へ出る**。復号鍵・署名・cookie の
     生バイトを扱う場所があるので、ここは長さだけ残す。 */
  if (ArrayBuffer.isView(value)) {
    return `[binary ${(value as ArrayBufferView).byteLength} bytes]`;
  }
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;

  /* URL は query に token が乗る。文字列として形の検査を通す。 */
  if (value instanceof URL) return redactString(value.href);

  /* Map / Set は `Object.entries` では空に見えるため、黙って中身が消える
     (「詰めたのに記録に無い」= 調査で嘘をつく)。明示的に開く。 */
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of value) {
      if (count >= MAX_KEYS) {
        out["…"] = `[+${value.size - MAX_KEYS} more]`;
        break;
      }
      const name = String(key);
      out[name] = isSensitiveKey(name) ? REDACTED : redact(item, depth + 1);
      count += 1;
    }
    return out;
  }
  if (value instanceof Set) {
    return redact([...value].slice(0, MAX_ARRAY), depth);
  }

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `[+${value.length - MAX_ARRAY} more]`] : head;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of safeEntries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        out["…"] = "[+more]";
        break;
      }
      out[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
      count += 1;
    }
    return out;
  }

  return "[unknown]";
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || NAME_KEY.test(key);
}

/**
 * 鍵と値を取り出す。**getter が投げても記録全体を落とさない**。
 *
 * 記録は catch の中から呼ばれるので、ここで投げると呼び出し元の catch を
 * 素通りする。logger 側にも安全網はあるが、そこで受けると**その 1 件の記録が
 * まるごと消える**。壊れているのは 1 項目だけだと分かる形で残す。
 */
function safeEntries(value: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const key of Object.keys(value)) {
    try {
      out.push([key, value[key]]);
    } catch {
      // expected-failure: getter が投げるのは相手方の都合。記録は続ける。
      out.push([key, "[unreadable]"]);
    }
  }
  return out;
}

/**
 * 例外そのものを Sentry に渡すときに、安全な複製を作る。
 *
 * stack はそのまま引き継ぐ (Sentry のまとめ方が stack に依るため)。上流の
 * メッセージに顧客のメールアドレスが入っている実例があるので、メッセージは
 * 必ず通す。
 *
 * ⚠ `cause` を必ず辿ること。Sentry は `error.cause` の連鎖を**自分で開いて
 *   送る**ので、外側のメッセージだけ直しても、`new Error("failed", { cause:
 *   upstreamError })` の形で内側に残った顧客情報はそのまま外へ出る。
 *   `fetch` の失敗や SDK の例外はほぼこの形で来るため、ここは机上の穴ではない。
 */
export function redactError(error: Error, depth = 0): Error {
  const safeMessage = redactString(error.message);
  const cause = (error as { cause?: unknown }).cause;

  const safeCause =
    cause === undefined || depth >= MAX_DEPTH
      ? undefined
      : cause instanceof Error
        ? redactError(cause, depth + 1)
        : redact(cause, depth + 1);

  /* 直すところが 1 つも無いなら、複製せずそのまま返す (stack の忠実さを保つ)。 */
  if (safeMessage === error.message && safeCause === cause) return error;

  const copy = new Error(safeMessage, safeCause === undefined ? undefined : { cause: safeCause });
  copy.name = error.name;
  copy.stack = error.stack ? redactString(error.stack) : undefined;
  return copy;
}
