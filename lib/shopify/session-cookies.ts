import { COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * Shopify セッション cookie を「何をどれだけの寿命で書くか」の唯一の正本。
 *
 * ## 直している割れ方 (as-is D-1)
 *
 * ログインは 4 つの cookie を書く。以前はそのうち 3 つ (`shop_at` / `shop_exp` /
 * `shop_auth`) に **アクセストークンの寿命** (`expires_in`、Shopify では時間単位) を
 * maxAge として付けていた。一方 `shop_rt` (リフレッシュトークン) だけが 30 日。
 *
 * `getSession()` は 3 つ全部が揃っていることを要求していたので、アクセストークンの
 * maxAge が過ぎてブラウザが `shop_at` を捨てた瞬間に `null` を返す。つまり
 * **30 日の `shop_rt` は原理的に一度も使われない**。`middleware.ts` も `shop_at` の
 * 有無で `/account` の門を張っていたので、数時間後に再訪した人は無言でログイン画面へ
 * 飛ばされていた。「ログインが切れた」「保存したものが消えた」という体験の一定割合は
 * これで説明できる (お気に入りのボタン 4 つが同時に押せなくなるため)。
 *
 * ## 直し方 — 生存判定を「鍵の寿命」から切り離す
 *
 * **cookie の寿命はすべて 30 日に揃え、期限判定は `shop_exp` の中身で行う。**
 *
 * - どれだけ生きているか (= いつまで再ログインなしで使えるか) は `shop_rt` が決める
 * - アクセストークンが切れているかどうかは `shop_exp` に**書いてある時刻**で決める
 *
 * この 2 つは別の話なのに、maxAge 経由で同じものにされていた。切り離すと、
 * アクセストークンが切れていても `shop_rt` でリフレッシュして続きができる。
 *
 * ⚠ `shop_at` が 30 日ブラウザに残ることは新しい露出ではない。httpOnly + 暗号化で、
 *   同じ条件の `shop_rt` / `shop_it` が既に 30 日で置かれている。中身のアクセス
 *   トークン自体は Shopify 側で時間で失効するので、古い文字列を持っていても使えない。
 *   リフレッシュが成功したときは、この同じ関数で上書きされる。
 *
 * ## なぜ「書く内容」だけを持つのか
 *
 * 書き込み先が 2 通りある。ログイン直後は `NextResponse` に直接載せ
 * (`app/api/auth/callback/route.ts`)、リフレッシュ後は Server Action / Route Handler の
 * cookie store に載せる (`lib/shopify/auth.ts` の `setSessionCookies`)。API が違うので
 * 「書く動作」は 1 本にできないが、**「何をどれだけの寿命で書くか」は 1 本にできる**。
 * ここが割れていたのが D-1 の実体なので、そこだけを正本にする。
 */

/**
 * セッション cookie の寿命 (秒)。**アクセストークンの寿命とは無関係**。
 *
 * リフレッシュトークンの有効期間に合わせてある。ここを縮めると、その時間で
 * 利用者が無言でログアウトする。
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** 1 つの cookie に何を書くか。`secure` / `sameSite` / `path` は書き込み側が付ける。 */
export type SessionCookieWrite = {
  /** 参考用。書き込み側は名前定数を直接使う (下の注意書きを読むこと)。 */
  name: string;
  value: string;
  /** `shop_auth` だけ false (ヘッダーの表示切り替えを JS から読むため)。 */
  httpOnly: boolean;
  maxAge: number;
};

/**
 * ログイン / リフレッシュのあとに書く 4 つの cookie。**役割で引ける形**にしてある。
 *
 * ⚠ 書き込み側は `cookies.set(<名前の定数>, w.accessToken.value, ...)` の形で書くこと。
 *   配列を回して `set(write.name, ...)` にすると、`__tests__/auth-cookie-registry.test.ts`
 *   の静的スキャナが cookie 名を解決できなくなる。あのスキャナは「set している名前が
 *   全部レジストリにある」「レジストリに死んだ名前が無い」を両方向で見ており、
 *   名前が動的になった瞬間にどちらも効かなくなる (= 未登録 cookie を静かに増やせる)。
 *   ここで正本にしたいのは **値と寿命**であって、名前の書き方ではない。
 */
export type SessionCookieWrites = {
  accessToken: SessionCookieWrite;
  refreshToken: SessionCookieWrite;
  expiresAt: SessionCookieWrite;
  authFlag: SessionCookieWrite;
};

/**
 * ログイン / リフレッシュのあとに書く 4 つの cookie を組み立てる。
 *
 * @param encrypt トークンの暗号化関数。呼び出し側から渡すのは、この module を
 *   `lib/shopify/customer.ts` (node crypto を含む) に依存させないため。
 * @param now テスト用の時刻注入。
 */
export function buildSessionCookieWrites({
  accessToken,
  refreshToken,
  expiresIn,
  encrypt,
  now = Date.now(),
}: {
  accessToken: string;
  refreshToken: string;
  /** Shopify が返すアクセストークンの残り秒数。**maxAge には使わない**。 */
  expiresIn: number;
  encrypt: (value: string) => string;
  now?: number;
}): SessionCookieWrites {
  return {
    accessToken: {
      name: COOKIE_NAME.shopAccessToken,
      value: encrypt(accessToken),
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
    refreshToken: {
      name: COOKIE_NAME.shopRefreshToken,
      value: encrypt(refreshToken),
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
    expiresAt: {
      /* 中身は「アクセストークンがいつ切れるか」。cookie 自体の寿命ではない。
         この値が過ぎていたら `getSession()` がリフレッシュする。 */
      name: COOKIE_NAME.shopExpiresAt,
      value: String(now + expiresIn * 1000),
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
    authFlag: {
      /* 画面の「ログイン / マイページ」の出し分けだけに使う非 httpOnly の旗。
         ここが先に消えると、ログインしているのにヘッダーが「ログイン」に戻る。 */
      name: COOKIE_NAME.shopAuthFlag,
      value: "1",
      httpOnly: false,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
  };
}
