import * as Sentry from "@sentry/nextjs";
import type { Firestore } from "firebase-admin/firestore";

import {
  mergeLineIdentityIntoShopify,
  type IdentityMergeResult,
} from "@/lib/auth/identity-merge";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/collections";
import { extractCustomerId } from "@/lib/firebase/types";
import {
  fetchShopifyCustomerIdForLineUser,
  invalidateReverseLinkage,
} from "@/lib/line/linkage-status";

/**
 * 「台帳に連携が成立した = データも合体している」を成り立たせる唯一の入口。
 *
 * ## 直している割れ方
 *
 * 連携には 2 つの独立した出来事があった。
 *
 *   1. **台帳の連携** … cx-agent の `customer_linkages` に行が立つ。以後
 *      `resolveIdentity` は LINE セッションを顧客の棚に解決する
 *   2. **データの合体** … `users/line:<id>/**` を `users/<customerId>/**` へ運ぶ
 *
 * この 2 つが**別々のトリガーで動き、互いを呼ばなかった**。実際の配線は
 * 次のとおりで、どの経路も片方しかやっていない（PR #100 が 28 ケースで固定）。
 *
 * | 経路 | 台帳 | 合体 | 結果 |
 * |---|---|---|---|
 * | マイページの連携ボタン (`/api/user/line-link/callback`) | 立つ | 走らない | 連携した瞬間にお気に入りが消えたように見える (B3) |
 * | LIFF (`/api/user/line-link-liff`) | 立つ | 走らない | 同上 |
 * | メールログイン (`/api/auth/callback`) | 立たない | 走る | 合体したのに次に LINE で入ると空の棚 (B4) |
 *
 * さらにメールログイン経路の合体は「`line_uid` cookie が同居している」だけで
 * 発火し、**その LINE と顧客が同じ人かを台帳で確かめていなかった**（B5）。
 * 共用端末に前の人の LINE セッションが残っていれば、その人のお気に入りが
 * 次の人の棚へ移る。
 *
 * ## 直し方 — 対を 1 か所に閉じる
 *
 * 3 経路すべてがこの関数を通る。ここが順番に、必ず対で行う。
 *
 *   1. 逆引きキャッシュを捨てる（`invalidateReverseLinkage`）
 *   2. **台帳に問い合わせて本人一致を確かめる**
 *   3. 一致したときだけ合体する
 *
 * ## なぜ「台帳に書く」ではなく「台帳を確かめる」なのか
 *
 * 対を成り立たせる方法は 2 つある。合体側から台帳に書きに行くか、台帳が
 * 成立していることを確かめてから合体するか。**後者を採る。**
 *
 * 前者だと、メールログイン経路が「cookie が同居していた」だけを理由に
 * 連携行を作ることになる。連携は本人が意思をもって押す操作で、その意思の
 * 記録が台帳の行そのものである。ブラウザに残っていた cookie を意思の代わりに
 * 使うのは、B5 の事故（他人のデータの持ち去り）を**台帳側にも広げる**だけ。
 *
 * 後者なら:
 *   - 連携ボタン / LIFF … いま台帳に行を立てた直後なので確認は必ず通り、合体する
 *   - メールログイン    … 既に連携済みの人だけが合体する（＝取りこぼしの再試行）
 *   - 未連携の人        … 何も起きない。cookie 同居だけでは動かない (B5 が閉じる)
 *
 * 「合体したのに台帳に無い」状態（B4）は、合体が台帳の確認を前提にした結果、
 * **どの経路からも作れなくなる**。
 *
 * ## 取りこぼしの再試行という副次効果
 *
 * 合体は失敗した分を必ず元の場所に残す（`identity-merge.ts` の 4 段）。
 * メールログインのたびにこの関数を通るので、連携済みの人の残りは次のログインで
 * 拾われる。合体は冪等なので、何度通っても増えない。
 *
 * ## 決して throw しない
 *
 * 連携も合体も、**ログインや連携そのものを失敗させてはいけない**副作用。
 * 台帳が読めない・Firestore が落ちている等は結果として返し、呼び出し側の
 * 応答（リダイレクト / 200）は変えない。呼び出し側に try/catch を書かせない
 * ため、ここで全部受け止める。
 */

/**
 * 合体まで到達したか、しなかったならなぜか。
 *
 *   - `merged`            … 台帳が本人一致を確認し、合体を実行した
 *   - `not-linked`        … 台帳に連携が無い。合体しない（cookie 同居だけでは動かない）
 *   - `linked-elsewhere`  … その LINE は**別の顧客**と連携している。合体しない
 *   - `ledger-unreadable` … 台帳が読めない。**推測しない**（次の機会に再試行）
 *   - `merge-failed`      … 一致は取れたが合体が hard fail した（元は残る）
 *   - `same-key`          … 引っ越し元と先が同じ。やることが無い
 *   - `invalid-input`     … 識別子が空。呼び出し側のバグ
 */
export type LinkageOutcome =
  | "merged"
  | "not-linked"
  | "linked-elsewhere"
  | "ledger-unreadable"
  | "merge-failed"
  | "same-key"
  | "invalid-input";

export type LinkageCompletion = {
  outcome: LinkageOutcome;
  /** `outcome === "merged"` のときだけ入る。 */
  merge: IdentityMergeResult | null;
};

/**
 * どの経路から呼ばれたか。ログ・Sentry の切り分け用で、判断には使わない
 * （経路によって安全性の基準を変えないため）。
 */
export type LinkageSource =
  | "line-link-callback"
  | "line-link-liff"
  | "auth-callback"
  /**
   * cx-agent が「台帳に行が立った」を通知してきた（M-2）。
   *
   * LINE トーク内の Account Link はこの経路でしか合体できない — その連携は
   * **web-app を一度も通らずに成立する**（LINE → cx-agent の webhook で完結する）ため、
   * web-app 側に合体を起こすきっかけが構造的に無かった。それが D-3 の正体である。
   */
  | "linkage-event";

/**
 * 台帳の連携成立を確かめ、成立していればデータを合体する。
 *
 * @param lineUserId **サーバ側で検証済み**の LINE userId のみ
 *   （`line_uid` cookie の復号結果 / LINE に検証させた id_token の `sub`）。
 *   ブラウザ自己申告の値を渡してはならない。
 * @param shopifyCustomerId **サーバ確定**の Shopify 顧客 ID
 *   （`requireAuth()` の結果 / 検証済み id_token のクレーム）。
 * @returns 何が起きたか。**決して throw しない**。
 */
export async function completeLineLinkage({
  lineUserId,
  shopifyCustomerId,
  source,
  db,
}: {
  lineUserId: string;
  shopifyCustomerId: string;
  source: LinkageSource;
  /** テスト用の注入。省略時は `getAdminFirestore()`。 */
  db?: Firestore;
}): Promise<LinkageCompletion> {
  const none = (outcome: LinkageOutcome): LinkageCompletion => ({
    outcome,
    merge: null,
  });

  /* 呼び出し側のバグ 2 種。**利用者の操作では起こりえない**。
   *
   * `invalid-input` は識別子が空のまま呼ばれた形で、`auth-callback` が
   * `shop_cid` を任意にしている以上、配線を変えた拍子に静かに増えうる
   * （そうなると連携済みの人の合体が丸ごと飛ぶ = as-is D-5 と同じ壊れ方）。
   * `same-key` は LINE の仮の棚のキーを顧客 ID として渡してしまった形。
   *
   * どちらも「何も起きずに正常終了する」ので、計装が無いと存在自体に気付けない。
   * 利用者起因では起こらない = 鳴ったら必ず直すべき、という意味で warning で残す。
   * ⚠ 識別子そのものは載せない（source だけで発生箇所は特定できる）。 */
  if (!lineUserId || !shopifyCustomerId) {
    console.warn(
      `[identity-link] line linkage skipped: invalid input (source=${source})`,
    );
    Sentry.captureMessage("Identity link called with empty identifier", {
      level: "warning",
      tags: { subsystem: "identity-link", source, outcome: "invalid-input" },
    });
    return none("invalid-input");
  }
  if (`line:${lineUserId}` === shopifyCustomerId) {
    console.warn(
      `[identity-link] line linkage skipped: same key (source=${source})`,
    );
    Sentry.captureMessage("Identity link source and target are the same key", {
      level: "warning",
      tags: { subsystem: "identity-link", source, outcome: "same-key" },
    });
    return none("same-key");
  }

  try {
    /* 1) 逆引きキャッシュを捨てる。
     *
     * 連携の直前に「未連携」を読んでいると、その答えが最大 60 秒キャッシュに
     * 残る。捨てないと、連携が成立したあとも `resolveIdentity` はしばらく
     * `line:` の棚を返し、その窓の中で書かれたお気に入りは**合体後に置き去りに
     * なる**（PR #100 の E3。合体は連携の瞬間にしか走らないので、窓の中の分を
     * 後から拾う経路が無い）。
     *
     * 捨てるのは下の確認より**先**。この直後の確認が台帳を引き直し、その
     * 新しい答え（＝連携済み）がキャッシュに載るので、次の画面描画は最初から
     * 正しい棚を見る。順番が逆だと、古い「未連携」を消したそばから確認の答えで
     * 書き戻す形になり、意味が無い。 */
    invalidateReverseLinkage(lineUserId);

    /* 2) 台帳で本人一致を確かめる。
     *
     * 3 値をそのまま扱う。`null`（読めなかった）を「連携なし」にも「連携あり」にも
     * 丸めない。読めないときに合体へ倒すと、外れた推測がそのまま他人のデータの
     * 持ち去りになる — 合体は**元を消す**操作なので、間違えたときに元に戻せない。 */
    const linked = await fetchShopifyCustomerIdForLineUser(lineUserId);

    if (linked === null) {
      /* 台帳が読めず、合体を見送った。**これは黙って通してよい分岐ではない。**
       *
       * 連携ボタン / LIFF から来た人はいま台帳に行を立てた直後なので、ここに
       * 落ちるのは台帳側が壊れている（不達 / 401 / 応答崩れ）ときだけ。その人は
       * 「連携できた」画面を見たのに、お気に入りは元の棚に残ったままになる。
       * 次のメールログインで再試行される作りなので**壊れ方としては静か**で、
       * 誰も気付かないまま何人分も積み上がりうる。
       *
       * console.warn だけでは残らない: 本番の Vercel ログ保持は Hobby プランの
       * 1 時間しかなく（scripts/ops/monitor-line-prod.mjs 冒頭の注記参照）、
       * 監視 cron が 60 分以上遅れれば痕跡ごと消える。**恒久記録は Sentry 側に
       * 持たせる。**
       *
       * 文言に "line" を含めているのは監視の取得側の都合。ログ取得は
       * `vercel logs --query line` で絞っており、`source=auth-callback` の行は
       * この語が無いと取得段階で落ちる（`[identity-link]` に "line" は無い）。 */
      console.warn(
        `[identity-link] line linkage ledger unreadable; skipping merge (source=${source})`,
      );
      Sentry.captureMessage("Identity link ledger unreadable; merge skipped", {
        level: "warning",
        tags: { subsystem: "identity-link", source },
      });
      return none("ledger-unreadable");
    }
    if (linked === false) {
      /* 台帳に連携が無い。**経路によって意味がまるで違う**ので、扱いを分ける。
       *
       *   auth-callback … メールログインのたびに通る取りこぼし再試行。未連携の人が
       *                   ログインしただけでここに来る。**これは正常**で、鳴らすと
       *                   ログイン数だけイベントが出て監視が無視されるようになる。
       *   連携ボタン / LIFF … いま台帳に行を立てた**直後**に呼ばれる。ここで
       *                   「連携が無い」と返ってくるのは、書き込みが成立して
       *                   いなかったか、書いた鍵と読んだ鍵が食い違っている
       *                   （本番で実際に起きている番号体系のずれ）ということ。
       *                   利用者には「連携しました」と出たのにデータは移らない。
       *                   **静かな壊れ方なので、必ず残す。**
       *
       * 正常な方も無音にはしない。ログは出して監視の判断に委ね、Sentry の
       * 割り当てだけを守る（ログは監視 cron が benign 判定できる）。 */
      const suspicious = source !== "auth-callback";
      console.warn(
        `[identity-link] line linkage ledger reports not linked; skipping merge (source=${source})`,
      );
      if (suspicious) {
        Sentry.captureMessage("Identity link ledger reports not linked", {
          level: "warning",
          tags: { subsystem: "identity-link", source, outcome: "not-linked" },
        });
      }
      return none("not-linked");
    }

    /* 顧客 ID の形（GID か数値か）は経路で揺れうるので、比較の前に数値部分へ
       正規化する。形の違いで本人一致を取り逃がすと、連携したのに合体しない
       という元の割れ方に戻る。 */
    if (extractCustomerId(linked) !== extractCustomerId(shopifyCustomerId)) {
      /* その LINE は別の顧客と連携している。合体しない。
         共用端末で前の人の LINE セッションが残っている典型で、ここで倒れる
         のが B5 の閉じ方そのもの。黙って落とさず可視化する。 */
      console.warn(
        `[identity-link] line user is linked to a different customer; skipping merge (source=${source})`,
      );
      Sentry.captureMessage("Identity link mismatch; merge skipped", {
        level: "warning",
        tags: { subsystem: "identity-link", source },
      });
      return none("linked-elsewhere");
    }

    /* 3) 顧客ドキュメントの写し（`users/{customerId}.lineUserId`）を揃える。
     *
     * Web / LIFF から連携した人には、この写しが**一度も書かれていなかった**（写しを
     * 書くのは旧 `POST /api/user/line-link` だけで、Web の連携導線はそこを通らない）。
     * その結果、解除の応答が写しだけを見て `not_linked` を返し、**台帳からは実際に
     * 外れているのに画面には「連携していませんでした」と出る**という食い違いが起きる。
     * 本番の連携済み 2 件とも、この写しが欠けていた。
     *
     * 台帳が本人一致を認めた**あと**に書くので、写しが台帳を追い越すことはない。
     * 失敗しても連携も合体も止めない（写しは台帳の従属物であって、正本ではない）。 */
    await mirrorLineUserId(lineUserId, shopifyCustomerId, source, db);

    // 4) 本人一致が取れた。ここで初めて合体する。
    const merge = await mergeLineIdentityIntoShopify(
      lineUserId,
      shopifyCustomerId,
      db,
    );
    return { outcome: "merged", merge };
  } catch (err) {
    /* 合体の中の per-document の失敗はここに来ない（counters で返る）。
       ここに来るのはコレクション列挙そのものの失敗など。連携・ログインは
       成立させたまま、事実だけ残す。 */
    console.error(`[identity-link] merge threw (source=${source}):`, err);
    Sentry.captureException(err, {
      tags: { subsystem: "identity-link", source },
    });
    return none("merge-failed");
  }
}

/**
 * **台帳に行が立ったと分かっている**ときに、合体だけを実行する（M-2）。
 *
 * ## `completeLineLinkage` と何が違うのか
 *
 * `completeLineLinkage` は「台帳を **HTTP で引き直して** 本人一致を確かめてから合体する」。
 * それは**まだ台帳の状態を知らない**呼び出し元（メールログインの取りこぼし再試行）には
 * 正しい。しかし連携経路 — LIFF / マイページの連携 CTA / LINE トーク内の Account Link —
 * は違う。**たった今その行を書いたばかり**である。
 *
 * その 3 経路が引き直していたせいで、次の形が構造的に保証されていた。
 *
 *   1. 書いた直後にキャッシュを捨て（`invalidateReverseLinkage`）
 *   2. 3 秒のタイムアウト付きで HTTP を投げ（`lib/line/linkage-status.ts`）
 *   3. **その一発が外れたら合体しない**
 *
 * 「連携しました」と画面に出たのに、お気に入りは元の棚に残ったまま — という壊れ方は
 * ここから出ていた。しかも次のメールログインまで誰も気付かない。
 *
 * 引き直しは「書いた事実」を確かめ直しているだけで、**書いた側より確かな情報源は無い**。
 * よって連携経路は本関数を使い、引き直しをやめる。
 *
 * ## 何を根拠に合体してよいのか（G1 をどう満たすか）
 *
 * G1 は「合体は本人一致を確認してから。cookie の同居を意思の代わりにしない」。本関数は
 * その確認を**引き直しではなく、台帳への書き込みが成立したこと**で満たす。書き込みには
 * 必ず本人の意思が先立つ（nonce の single-use 消費 / state cookie に封じた顧客 ID /
 * 検証済み id_token の sub）。
 *
 * @param lineUserId **サーバ側で検証済み**の LINE userId のみ。
 *   ブラウザ自己申告や、リクエスト body からそのまま流し込んだ値を渡してはならない。
 * @param shopifyCustomerId **サーバ確定**の Shopify 顧客 ID のみ。
 * @returns 何が起きたか。**決して throw しない**。
 */
export async function applyLinkageEstablished({
  lineUserId,
  shopifyCustomerId,
  source,
  db,
}: {
  lineUserId: string;
  shopifyCustomerId: string;
  source: LinkageSource;
  db?: Firestore;
}): Promise<LinkageCompletion> {
  const none = (outcome: LinkageOutcome): LinkageCompletion => ({
    outcome,
    merge: null,
  });

  if (!lineUserId || !shopifyCustomerId) {
    console.warn(
      `[identity-link] line linkage skipped: invalid input (source=${source})`,
    );
    Sentry.captureMessage("Identity link called with empty identifier", {
      level: "warning",
      tags: { subsystem: "identity-link", source, outcome: "invalid-input" },
    });
    return none("invalid-input");
  }
  if (`line:${lineUserId}` === shopifyCustomerId) {
    console.warn(
      `[identity-link] line linkage skipped: same key (source=${source})`,
    );
    return none("same-key");
  }

  try {
    /* 逆引きキャッシュは捨てる。捨てないと、連携の直前に読んだ「未連携」が最大 60 秒
       残り、その窓の中で書かれたお気に入りが**合体後に置き去りになる**（合体は
       この 1 回しか走らないので、後から拾う経路が無い）。
       ⚠ 引き直しはしない — それが M-2 で廃止した構造そのもの。 */
    invalidateReverseLinkage(lineUserId);

    await mirrorLineUserId(lineUserId, shopifyCustomerId, source, db);

    const merge = await mergeLineIdentityIntoShopify(
      lineUserId,
      shopifyCustomerId,
      db,
    );
    return { outcome: "merged", merge };
  } catch (err) {
    console.error(`[identity-link] merge threw (source=${source}):`, err);
    Sentry.captureException(err, {
      tags: { subsystem: "identity-link", source },
    });
    return none("merge-failed");
  }
}

/**
 * `users/{customerId}.lineUserId` に写しを置く（冪等・失敗しても呼び出し元を止めない）。
 *
 * この写しは**正本ではない**。連携の正本は cx-agent の `customer_linkages` で、ここは
 * 「この顧客に LINE が繋がっている」ことを Firestore 側から見えるようにするためだけの
 * 従属データ。だから台帳の確認を通ったあとにしか書かないし、書けなくても連携は成立
 * させたままにする。
 *
 * `merge: true` で既存フィールドを消さない（この直後に走る合体が `users/line:*` の
 * フィールドを畳んでくるので、上書き set は取り違えの元になる）。
 */
async function mirrorLineUserId(
  lineUserId: string,
  shopifyCustomerId: string,
  source: LinkageSource,
  db?: Firestore,
): Promise<void> {
  try {
    const firestore = db ?? getAdminFirestore();
    await firestore.doc(userDoc(shopifyCustomerId)).set(
      { lineUserId, lastActiveAt: new Date() },
      { merge: true },
    );
  } catch (err) {
    /* 写しが書けなかっただけ。台帳は成立しており、次のログインでこの関数を
       もう一度通るので自然に埋まる。連携の成否は変えない。 */
    console.warn(
      `[identity-link] failed to mirror lineUserId onto customer doc (source=${source}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
