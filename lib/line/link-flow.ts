import crypto from "crypto";

import { readSecretEnvTrimmed } from "@/lib/env";
import { encryptToken, decryptToken } from "@/lib/shopify/customer";

/**
 * Web 発 LINE 連携フロー（P2）の state 束縛。
 *
 * ## 何を解いているか
 *
 * これまで Web マイページの「LINEと連携する」は LIFF permanent link
 * （`https://liff.line.me/...`）だった。LIFF は **LINE アプリ / LINE 内ブラウザへ離脱する**
 * ので、押した瞬間に Chrome から Safari（や LINE 内ブラウザ）へ移り、そこには Shopify の
 * ログインセッションが無い。だから 1 回目は「誰か分からない」で失敗し、成功しても
 * 「トークに戻る」しか出口が無くマイページに帰れなかった。
 *
 * P2 は LIFF を経由せず、**押したブラウザのまま** LINE の認可へ行き、同じブラウザの
 * マイページへ 302 で戻す。そのために必要なのが「行きと帰りを結ぶ state」で、本モジュールは
 * その封緘と検証だけを担う（HTTP も cookie もここでは触らない。route 側の責務）。
 *
 * ## なぜ nonce だけでは足りないか（QA 要件 5 / login-CSRF）
 *
 * 素朴な OAuth state は「ランダム値を cookie に置き、戻ってきた state と一致するか」だけを
 * 見る。それだと **攻撃者が自分の LINE で得た認可 code を含む callback URL を被害者に踏ませ、
 * 被害者の Shopify アカウントに攻撃者の LINE を連携させる**経路（login-CSRF）を、原理的には
 * 塞げるが「誰のために始めた連携か」は塞げない。連携は「今ログインしている顧客」と不可分な
 * 操作なので、state に **開始時点の顧客 ID** を封じ込め、callback でその場のセッションと
 * 一致することまで確かめる。
 *
 * したがって callback が連携を成立させてよいのは、次の 5 つが **すべて**満たされたときだけ:
 *
 *   1. cookie が復号できる（= 我々が発行したもの。SESSION_SECRET を知らないと作れない）
 *   2. cookie 内 state と URL の `state` が一致する（timing-safe 比較）
 *   3. cookie 内 customerId と、その場の `requireAuth()` の customerId が一致する
 *   4. 発行から `STATE_TTL_MS` 以内である
 *   5. cookie 内 nonce と、戻ってきた id_token の `nonce` claim が一致する（D11・下記）
 *
 * どれか 1 つでも欠けたら連携しない（fail-closed）。「たぶん本人だろう」で通さない。
 *
 * 5 番目が要るのは、1〜4 が見ているのが**認可応答**（code と state）だけだからである。
 * 交換して得た **id_token 自体**が「この認可要求で発行されたもの」かどうかは、そこに
 * 焼き込まれた nonce でしか確かめられない。検証は `verifyLiffIdToken` の `expectedNonce`
 * に渡して行う（OIDC Core §3.1.3.7 step 11 / 設計書 v1.2 の D11）。
 *
 * ## 暗号化であって署名ではない理由
 *
 * 中身に顧客 ID が入るため、Base64 で誰でも読める形にはしない。`encryptToken` は
 * AES-256-GCM（認証付き暗号）なので、機密性と改竄検知を同時に得られる。署名だけだと
 * 顧客 ID が平文で cookie に載る。
 */

/** state cookie の名前。`lib/auth/cookies.ts` のレジストリにも登録すること（未登録は test で落ちる）。 */
export const LINE_LINK_STATE_COOKIE = "line_link_state";

/**
 * state の有効期間。LINE 認可の往復に必要な時間だけを与える。
 *
 * 10 分は既存の `line_oauth_state`（maxAge 600）と揃えた値。長くするほど
 * 「開始したまま放置された state」を攻撃者が拾える窓が広がる。
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** マイページに結果を伝えるクエリキー。完了画面は作らない（要件 4）ので、これが唯一の通知路。 */
export const LINK_RESULT_PARAM = "line_link";

/**
 * 連携結果。`success` 以外はすべて「連携していない」。
 *
 * 失敗理由を細かく URL に出さないのは、外から state 検証の内訳を推測させないため。
 * 詳細はサーバログにだけ残す。
 */
export type LinkResult = "success" | "error";

/**
 * 連携（P2）の token 交換と存在ゲートに使う Channel Secret を解決する。
 *
 * `LINE_LIFF_CHANNEL_ID` と `LINE_LOGIN_CHANNEL_ID` は同一 Login チャネル (2009473839) を指すため、
 * その Channel Secret は `LINE_LOGIN_CHANNEL_SECRET` と同値である。P2 は `LINE_LIFF_CHANNEL_SECRET`
 * を優先し、未設定時は既存の `LINE_LOGIN_CHANNEL_SECRET` にフォールバックする。
 *
 * 狙いは **Vercel 本番に新しいシークレットを入れさせないこと**。本番には既に
 * `LINE_LOGIN_CHANNEL_SECRET`（Web ログイン用 / 同一チャネル）が設定済みで、
 * `LINE_LIFF_CHANNEL_SECRET` は未設定でも、このフォールバックで連携の code→token 交換が通る。
 *
 * どちらも未設定なら `undefined` を返し、呼び出し側は「このデプロイでは連携できない」
 * （init は 503 / callback は fail-closed）として扱う。
 *
 * ## 値は必ず trim する（2026-08-22 の本番障害の直接原因）
 *
 * `vercel env add NAME production < file` のように **標準入力から値を流し込むと、
 * 末尾の改行までが値として保存される**。Channel Secret はもともと 32 文字の不透明な
 * 文字列なので、33 文字目が改行でもダッシュボード上は正しく見える。気づけるのは
 * LINE がそれを拒んだときだけで、返ってくるのは
 * `400 error=invalid_client error_description=invalid client_secret` という
 * 「秘密が違う」としか言わない汎用エラーである。
 *
 * 実際、本番の `LINE_LOGIN_CHANNEL_SECRET` はこの状態で保存されており、Web 発の連携は
 * token 交換の一手前まで正しく進んだうえで毎回そこで落ちていた。同じチャネル
 * (2009473839) の秘密でも、メールログインが読む `AUTH_LINE_SECRET` は改行なしで
 * 保存されていたため**ログインだけは通り続け**、連携の不具合に見えていた。
 *
 * よって「本番の値を一度掃除する」では直したことにならない。**コード側を不感にする**
 * （= `readSecretEnvTrimmed` を通す）ことで、同じ入れ方をされても二度と再発しない。
 * 同じ判断の先例が `lib/env.ts`（`NEXT_PUBLIC_SITE_URL` の改行が sitemap を壊した件）。
 */
export function resolveLinkChannelSecret(): string | undefined {
  return (
    readSecretEnvTrimmed(process.env.LINE_LIFF_CHANNEL_SECRET) ??
    readSecretEnvTrimmed(process.env.LINE_LOGIN_CHANNEL_SECRET)
  );
}

/**
 * 連携（P2 / LIFF 経路とも）が使う LINE Login チャネルの Channel ID。
 *
 * 秘密と同じ理由で trim する。こちらは token 交換の `client_id` になるだけでなく、
 * `verifyLineIdToken` で **id_token の `aud` と等値比較**される。改行が 1 文字混じると
 * 比較が必ず外れ、「LINE の署名は通ったのに aud が一致しない」という、原因に辿り着き
 * にくい失敗の仕方をする。
 *
 * 空文字・未設定は `undefined`（＝このデプロイでは連携できない）に倒す。空文字のまま
 * LINE に送ると、設定漏れが「認可エラー」として顧客側に出てしまう。
 */
export function resolveLinkChannelId(): string | undefined {
  return readSecretEnvTrimmed(process.env.LINE_LIFF_CHANNEL_ID);
}

/** cookie に封じる中身。キーを 1 文字にしているのは cookie サイズを抑えるため。 */
type SealedState = {
  /** state（URL の `state` と突き合わせる値）。 */
  n: string;
  /** 連携を始めた時点の、サーバ確定 Shopify 顧客 ID。 */
  c: string;
  /** 完了後に戻す先（同一オリジン相対パス）。 */
  r: string;
  /** 発行時刻（epoch ms）。 */
  t: number;
  /**
   * OIDC `nonce`（D11）。認可 URL に載せ、戻ってきた id_token の `nonce` claim と照合する。
   *
   * `n`（state）とは役割が違う。state は「この**応答**が、このブラウザが始めた往復のものか」
   * を見る。nonce は「この**id_token** が、その認可要求で発行されたものか」を見る。前者だけだと、
   * 別の認可要求で得た id_token をこの往復に差し込む余地が残る（OIDC Core §3.1.3.7 step 11）。
   * 値を分けているのは、片方が URL に出る（state）のに対しもう片方は id_token の中でしか
   * 突き合わせない（nonce）ためで、同じ値を使い回すと nonce が URL 経由で観測可能になる。
   */
  o: string;
};

export type SealedStateInput = {
  customerId: string;
  returnTo: string;
};

export type StateEnvelope = {
  /** URL の `state` パラメータに載せる値。 */
  state: string;
  /** 認可 URL の `nonce` パラメータに載せる値。 */
  nonce: string;
  /** cookie に入れる暗号文。 */
  cookieValue: string;
};

/**
 * state と nonce を作り、顧客 ID と復帰先とともに封じた cookie 値を返す。
 */
export function sealLinkState(input: SealedStateInput, now = Date.now()): StateEnvelope {
  const state = crypto.randomBytes(32).toString("hex");
  const nonce = crypto.randomBytes(32).toString("hex");
  const payload: SealedState = {
    n: state,
    c: input.customerId,
    r: input.returnTo,
    t: now,
    o: nonce,
  };
  return { state, nonce, cookieValue: encryptToken(JSON.stringify(payload)) };
}

export type OpenStateResult =
  | { ok: true; returnTo: string; nonce: string }
  | { ok: false; reason: string };

/**
 * cookie を開き、上記 4 条件を検査する。
 *
 * @param cookieValue  `line_link_state` の値（無ければ undefined）
 * @param stateParam   callback URL の `state`
 * @param customerId   その場の `requireAuth()` が確定した顧客 ID
 *
 * 返す `returnTo` は封じた時点の値。**callback は URL から復帰先を受け取ってはならない**
 * （受け取れる形にした瞬間、この endpoint が任意 URL へのリダイレクタになる）。
 */
export function openLinkState(
  cookieValue: string | undefined | null,
  stateParam: string | undefined | null,
  customerId: string,
  now = Date.now(),
): OpenStateResult {
  if (!cookieValue) return { ok: false, reason: "state_cookie_missing" };
  if (!stateParam) return { ok: false, reason: "state_param_missing" };

  const decrypted = decryptToken(cookieValue);
  if (!decrypted) return { ok: false, reason: "state_undecryptable" };

  let payload: SealedState;
  try {
    payload = JSON.parse(decrypted) as SealedState;
  } catch {
    return { ok: false, reason: "state_malformed" };
  }

  /* `o`（nonce）が無い cookie は、nonce 導入**前**に発行されたもの。通さない。
   * 「古い形式なら nonce 検証を飛ばす」互換分岐を置くと、攻撃者は cookie を旧形式に
   * 見せかけるだけで検証を外せる。TTL は 10 分なので、デプロイ直後にこれを踏んだ人は
   * マイページに戻ってもう一度押せばよい（連携は起きていないのでデータは変化しない）。 */
  if (
    typeof payload?.n !== "string" ||
    typeof payload?.c !== "string" ||
    typeof payload?.r !== "string" ||
    typeof payload?.t !== "number" ||
    typeof payload?.o !== "string" ||
    payload.o.length === 0
  ) {
    return { ok: false, reason: "state_malformed" };
  }

  if (!timingSafeEqualStrings(payload.n, stateParam)) {
    return { ok: false, reason: "state_mismatch" };
  }

  /* セッション束縛。ここが「攻撃者の LINE を被害者のアカウントに繋ぐ」経路の栓。
   * 開始したときの顧客と、戻ってきたときの顧客が違うなら、それはもう別の操作。 */
  if (!timingSafeEqualStrings(payload.c, customerId)) {
    return { ok: false, reason: "customer_mismatch" };
  }

  if (now - payload.t > STATE_TTL_MS || now < payload.t - 60_000) {
    /* 未来日付も弾く（サーバ時計のずれは 1 分だけ許容）。 */
    return { ok: false, reason: "state_expired" };
  }

  /* 封じた時点で検証済みだが、cookie は 10 分間ブラウザに残る。その間に
   * `sanitizeReturnTo` の規則を厳しくした場合、古い cookie が旧規則の値を運んでくる。
   * 出口でもう一度通すことで、規則の変更が即座に効く。 */
  return {
    ok: true,
    returnTo: sanitizeReturnTo(payload.r, defaultReturnTo("ja")),
    nonce: payload.o,
  };
}

/**
 * 復帰先の既定値。
 */
export function defaultReturnTo(locale: string): string {
  const safe = /^[a-z]{2}$/.test(locale) ? locale : "ja";
  return `/${safe}/account`;
}

/**
 * 復帰先を「自サイト内の相対パス」に限定する。
 *
 * 落とすもの（すべてオープンリダイレクタの材料）:
 *   - `https://evil.example`  … スキーム付き絶対 URL
 *   - `//evil.example`        … プロトコル相対 URL。ブラウザは外部ホストとして解決する
 *   - `/\evil.example`        … 一部ブラウザが `//` と同一視するバックスラッシュ変種
 *   - `evil` のような相対断片 … `/` 始まりでないものは受けない（解決先が文脈依存になる）
 *
 * 通すのはパス + クエリ + フラグメントのみ。判定が少しでも曖昧なら既定値に倒す。
 */
export function sanitizeReturnTo(raw: string | undefined | null, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  /* 制御文字・改行はヘッダー分割の材料になるので拒否。 */
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (raw.includes("\\")) return fallback;
  return raw;
}

/** 結果クエリを付けた復帰 URL（相対）を組み立てる。 */
export function returnUrlWithResult(returnTo: string, result: LinkResult): string {
  const [path, hash = ""] = splitHash(returnTo);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${LINK_RESULT_PARAM}=${result}${hash ? `#${hash}` : ""}`;
}

function splitHash(value: string): [string, string?] {
  const i = value.indexOf("#");
  if (i === -1) return [value];
  return [value.slice(0, i), value.slice(i + 1)];
}

/**
 * 長さ差を先に見てから `timingSafeEqual`。`crypto.timingSafeEqual` は長さが違うと
 * 例外を投げるため、素で呼ぶと「長さが違う」ことだけが例外の有無で漏れる。
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
