/**
 * 匿名で来た人に配る不透明な ID（CDP 統合 Stage 1 / 欠陥 D2）。
 *
 * ## いま何が起きているか
 *
 * ログインしていない来訪者の行動は **1 件も残っていない**。送り手
 * （`behavior-tracker`）がセッション cookie を見て早期 return し、受け口
 * （`/api/user/behavior`）も未認証なら `skipped` を返すので、クライアントとサーバの
 * 二重のゲートで落ちている。結果、「初めて来た人が何を見て、何を見て帰ったか」が
 * 構造的に存在しない。CDP が全段階を積むと言いながら、いちばん最初の一歩だけが空白。
 *
 * ## ここが配るもの・配らないもの
 *
 * 配るのは **この端末を指すだけの不透明な文字列**。名前でも、メールでも、
 * どのサイトでも通じる ID でもない。サーバはこれを鍵にして主体（subject）を引く。
 * **subject_id 自体はブラウザに渡さない**（表示しない・URL に出さない、が設計の約束）。
 *
 * ## cookie ではなく localStorage
 *
 * cookie を増やすと、同意バナーで説明している範囲・cookie 台帳
 * （`lib/auth/cookie-names.ts`）・送信されるリクエストの中身がすべて変わる。
 * ここが要るのは「この端末で前に何を見たか」を繋ぐことだけなので、
 * サーバへ自動で送られない localStorage で足りる（送るかどうかは送り手が決める）。
 *
 * ## 同意が無ければ **読みも書きもしない**
 *
 * `consent === "all"`（解析・マーケティングの許可）のときだけ発行し、保存する。
 * 未選択・essential では **保存もせず、既存の値も読まない**。
 * 「保存はするが送らない」にしないのは、同意していない人の端末に痕跡を残さないため。
 *
 * localStorage は storage がブロックされた文脈（Safari の全 cookie ブロック・
 * LINE の in-app ブラウザ等）で **throw する**。この site は LIFF 連携でまさに
 * その in-app ブラウザから開かれるので、すべてのアクセスを guard する
 * （`lib/consent.ts` と同じ方針）。
 */

import { isAnalyticsAllowed, readStoredConsent } from "@/lib/consent";

export const ANONYMOUS_ID_STORAGE_KEY = "elxea-cdp-anon-id";

/** 32 桁の 16 進数。意味を持たない（時刻も端末情報も含まない）。 */
const ANONYMOUS_ID_RE = /^[0-9a-f]{32}$/;

export function isAnonymousId(value: unknown): value is string {
  return typeof value === "string" && ANONYMOUS_ID_RE.test(value);
}

/** 128bit の乱数を 16 進数へ。純粋（注入可能）なのでテストで固定できる。 */
export function formatAnonymousId(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readStored(): string | null {
  try {
    const raw = window.localStorage.getItem(ANONYMOUS_ID_STORAGE_KEY);
    return isAnonymousId(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * この端末の匿名 ID を返す。無ければ発行して保存する。
 *
 * @returns 同意が無い / storage が使えない / 保存できなかったときは `null`。
 *   null は「記録しない」の意味であり、呼び出し側は何も送らない。
 */
export function getOrIssueAnonymousId(): string | null {
  if (typeof window === "undefined") return null;
  if (!isAnalyticsAllowed(readStoredConsent())) return null;

  const existing = readStored();
  if (existing) return existing;

  let id: string;
  try {
    id = formatAnonymousId(window.crypto.getRandomValues(new Uint8Array(16)));
  } catch {
    return null;
  }

  try {
    window.localStorage.setItem(ANONYMOUS_ID_STORAGE_KEY, id);
  } catch {
    /* storage が使えないなら **発行しなかったことにする**。保存できない ID を
       送ると、リロードのたびに別人として積まれ、L0 に幽霊が増えるだけになる。 */
    return null;
  }
  return id;
}

/** 同意を取り消したときに痕跡を消す（呼び出しは同意 UI 側）。 */
export function forgetAnonymousId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ANONYMOUS_ID_STORAGE_KEY);
  } catch {
    /* 消せないなら消せない。ここで throw しても画面が壊れるだけで何も直らない。 */
  }
}
