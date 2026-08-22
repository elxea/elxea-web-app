/**
 * Firestore collection path constants.
 * Centralizes all collection references to avoid typos and enable easy refactoring.
 */

export const COLLECTIONS = {
  /** Top-level users collection */
  users: "users",
  /** Subcollection under users/{userId} — product / article favorites */
  favorites: "favorites",
  /** Subcollection under users/{userId} — farmer follows */
  follows: "follows",
  /** Subcollection under users/{userId} — event registrations */
  eventRegistrations: "eventRegistrations",
  /** Subcollection under users/{userId} — cross-channel behavior events (NEW) */
  behaviorLog: "behaviorLog",
  /** Subcollection under users/{userId} — LINE conversation history (NEW) */
  conversations: "conversations",
  /** Subcollection under users/{userId} — Shopify order mirror (NEW) */
  orders: "orders",
  /** Top-level comments collection */
  comments: "comments",
} as const;

/**
 * すべてのコレクション名。`COLLECTIONS` に足したものがここに現れる。
 */
export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * `users/{userKey}` の下にぶら下がるサブコレクション。**この一覧が、識別子を
 * 引っ越すとき（LINE 単独 → メール連携済み）に運ぶ荷物の全量**である。
 *
 * ## なぜ定数を並べ直すのか
 *
 * 合体（`lib/auth/identity-merge.ts`）はかつて favorites / follows /
 * eventRegistrations の 3 つを**関数の中に直接書いて**いた。その後
 * `COLLECTIONS` に behaviorLog / conversations / orders が足されたが、合体側は
 * 誰も直さなかった。結果、連携したお客さまの行動ログ・会話履歴・注文ミラーは
 * `users/line:<id>/` に取り残され、連携後は LINE でもメールでも読めない場所に
 * 消えた（PR #100 の B2 が固定した現状）。
 *
 * 「足したのに運ばれない」を人間の注意力で防ぐのをやめる。合体はこの配列から
 * 仕事一覧を導出し、strategy 表を `Record<UserSubcollection, …>` で受けるので、
 * **ここに 1 行足して strategy を書かなければ型エラーになる**。
 *
 * 新しいサブコレクションを `COLLECTIONS` に足したら、必ず
 *   - 各ユーザーの下にぶら下がる → この配列に足す
 *   - トップレベル（横断クエリ用） → `NON_USER_COLLECTIONS` に足す
 * のどちらかを行う。どちらにも入れないと
 * `__tests__/firestore-collection-coverage.test.ts` が落ちる。
 */
export const USER_SUBCOLLECTIONS = [
  COLLECTIONS.favorites,
  COLLECTIONS.follows,
  COLLECTIONS.eventRegistrations,
  COLLECTIONS.behaviorLog,
  COLLECTIONS.conversations,
  COLLECTIONS.orders,
] as const;

export type UserSubcollection = (typeof USER_SUBCOLLECTIONS)[number];

/**
 * `users/{userKey}` の下ではないコレクション。識別子の引っ越しの対象外である
 * ことを**明示的に**宣言する（「書き忘れ」と「対象外」を区別するため）。
 *
 *   - `users`    … 親そのもの。ドキュメント本体は `userDoc` が別途運ぶ
 *   - `comments` … トップレベル。所有者は `authorId` フィールドで持つので、
 *                  引っ越しはドキュメントの移動ではなくフィールドの書き換えに
 *                  なる（本 PR の対象外・別途）
 */
export const NON_USER_COLLECTIONS = [
  COLLECTIONS.users,
  COLLECTIONS.comments,
] as const;

/**
 * Build Firestore path helpers.
 */
export function userDoc(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}`;
}

/**
 * `users/{userKey}/{sub}` を組み立てる。合体はコレクションごとの専用ヘルパー
 * （`favoritesCol` 等）ではなくこれを使う — 専用ヘルパーを 1 つずつ呼ぶ形だと、
 * 結局「呼び忘れ」が `USER_SUBCOLLECTIONS` の外で起きるため。
 */
export function userSubcollection(customerId: string, sub: UserSubcollection) {
  return `${COLLECTIONS.users}/${customerId}/${sub}`;
}

export function favoritesCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.favorites}`;
}

export function followsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.follows}`;
}

export function eventRegistrationsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.eventRegistrations}`;
}

export function behaviorLogCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.behaviorLog}`;
}

export function conversationsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.conversations}`;
}

export function ordersCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.orders}`;
}
