/**
 * 歓迎メールを「本当に初回登録のときだけ・1 人につき 1 通だけ」に閉じる門。
 *
 * ## 何が壊れていたか（2026-08-30 本番・オーナー実地遭遇）
 *
 * `/api/auth/callback` は **ログインのたびに**歓迎メールを送っていた。送るかどうかの
 * 判定が `customer.orders.edges.length === 0`（＝注文履歴が無い）1 つだけだったからである。
 *
 *   「注文したことが無い」≠「いま登録したばかり」
 *
 * この 2 つを同じものとして扱うと、**一度登録して一度も買っていない会員は、ログインする
 * たびに「ご登録ありがとうございます」を受け取る**。登録は 1 回きりの出来事なので、
 * 2 通目以降は事実として誤っている。オーナーは過去のテストで登録済みのアドレスに
 * 歓迎メールが再送されたことでこれを踏んだ。
 *
 * 送信は取り消せない。だからこの門は 2 つの独立した条件を **両方** 要求する:
 *
 *   1. **陽性の新しさ** — Shopify の `Customer.creationDate` が直近であること。
 *      「注文が無い」という**不在の証拠**ではなく、「たった今できた顧客だ」という
 *      **在ることの証拠**で判定する。不在の証拠は古い会員と新しい会員を区別できない。
 *   2. **一度きりの権利取得（claim）** — 1 顧客につき 1 回しか成立しない。
 *      1 だけでは、登録直後に何度もログインした人に何通も送りうる（creationDate は
 *      窓の中に留まり続ける）。台帳に印を付けてから送ることで、窓の中で何回
 *      ログインしても 2 通目が出ない。
 *
 * ## 印を「送る前」に付ける理由
 *
 * 送信してから印を付けると、送信は成功したのに印を付ける前に落ちた回で二重送信になる。
 * 逆順（印 → 送信）なら、最悪の失敗は「送られなかった」であって「二重に送られた」では
 * ない。**外部送信では、取り消せない側に倒れない順序を選ぶ。**
 * 送信そのものが失敗したときだけ印を戻す（`releaseWelcomeClaim`）ので、次のログインで
 * もう一度だけ試される。
 *
 * ## 台帳が読めないときは送らない（fail-closed）
 *
 * Firestore に届かないと「もう送ったか」が言えない。言えないまま送るのは
 * 「たぶん初回だろう」で外部送信することであり、この経路が起こした事故そのものである。
 * 判定できないときは送らずに理由を残す。
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { userDoc } from "@/lib/firebase/collections";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/log";

/**
 * 「たった今登録した」とみなす窓。
 *
 * Shopify の新しい Customer Account では、顧客レコードは**初回ログインの瞬間**に
 * 作られる。よって本物の初回登録では `creationDate` は数秒前になる。24 時間は
 * その数秒に対して十分に余裕があり、かつ「昔登録した会員」を巻き込まない幅として
 * 選んでいる（1 日以上前に登録した人に「ご登録ありがとうございます」は送らない）。
 */
export const FRESH_REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 歓迎メールを送った事実を書く場所（`users/{customerId}` のフィールド）。 */
export const WELCOME_SENT_FIELD = "welcomeEmailSentAt";

/**
 * `creationDate` が「いま登録したばかり」と言えるか（純粋関数）。
 *
 * `null` / 不正な日付 / **未来の日付** はすべて false。未来を弾くのは、時計のずれや
 * 壊れた値で窓が無限に広がるのを防ぐため（`now - created` が負なら新しさの証拠にならない）。
 */
export function isFreshRegistration(
  creationDate: Date | null | undefined,
  nowMs: number,
  windowMs: number = FRESH_REGISTRATION_WINDOW_MS,
): boolean {
  if (!creationDate) return false;
  const createdMs = creationDate.getTime();
  if (!Number.isFinite(createdMs)) return false;
  const age = nowMs - createdMs;
  return age >= 0 && age <= windowMs;
}

/** 権利取得の結果。**理由なしで戻る枝を作らない**（呼び出し側が 1 行ログに出せるように）。 */
export type WelcomeClaim =
  /** この呼び出しが初回。送ってよい（印は既に付いている）。 */
  | { ok: true }
  /** 既に送信済み。**送ってはいけない。** */
  | { ok: false; reason: "already-sent" }
  /** 顧客 ID が無い。判定できないので送らない。 */
  | { ok: false; reason: "no-customer-id" }
  /** 台帳に届かない / 書けない。判定できないので送らない（fail-closed）。 */
  | { ok: false; reason: "ledger-unavailable"; detail: string };

/**
 * 「この顧客に歓迎メールを送る権利」を一度だけ取得する。**決して throw しない。**
 *
 * トランザクションで「読んで、無ければ書く」を 1 つの原子操作にする。同じ人が同時に
 * 2 つのタブでログインしても、成立するのは片方だけ（もう片方は `already-sent`）。
 * `merge` ではなく `set(..., { merge: true })` を使うのは、`users/{id}` に既にある
 * お気に入り等のフィールドを消さないため。
 *
 * @param db テスト用の注入。省略時は `getAdminFirestore()`。
 */
export async function claimWelcomeEmail(
  customerId: string | null | undefined,
  db?: Firestore,
): Promise<WelcomeClaim> {
  if (!customerId) return { ok: false, reason: "no-customer-id" };

  try {
    const firestore = db ?? getAdminFirestore();
    const ref = firestore.doc(userDoc(customerId));

    const claimed = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get(WELCOME_SENT_FIELD)) return false;
      tx.set(ref, { [WELCOME_SENT_FIELD]: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });

    return claimed ? { ok: true } : { ok: false, reason: "already-sent" };
  } catch (err) {
    /* 送らない側に倒す。ここで送ると「もう送ったかどうか分からないまま外部送信する」
       ことになり、直そうとしている事故と同じ形になる。 */
    return {
      ok: false,
      reason: "ledger-unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 送信そのものが失敗したときに印を戻す（**決して throw しない**）。
 *
 * 戻せなければその人は歓迎メールを受け取らないまま終わる。二重送信より軽い失敗なので、
 * ここでの失敗はログに残すだけで、呼び出し側の流れは止めない。
 */
export async function releaseWelcomeClaim(
  customerId: string | null | undefined,
  db?: Firestore,
): Promise<void> {
  if (!customerId) return;
  try {
    const firestore = db ?? getAdminFirestore();
    await firestore
      .doc(userDoc(customerId))
      .set({ [WELCOME_SENT_FIELD]: FieldValue.delete() }, { merge: true });
  } catch (err) {
    logger.error("email.welcome.claim-release-failed", err, {
      operation: "releaseWelcomeClaim",
    });
  }
}
