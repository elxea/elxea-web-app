/**
 * LINE Login チャネルの単一の定義場所（M-0）。
 *
 * ## これが何を直しているか
 *
 * elxea には LINE の利用者 ID が **2 系統** あった。
 *
 *   - 台帳 (`customer_linkages.line_user_id`) に入るのは、本番公式アカウント
 *     `@307tzhkw` の **Messaging チャネル (2008324925)** 由来の userId
 *   - Web のログイン・連携が問い合わせに使うのは、**LINE Login チャネル
 *     (旧 2009473839)** 由来の userId
 *
 * LINE の userId は **プロバイダ単位**で採番される。旧 Login チャネルは Messaging
 * チャネルとは別プロバイダにあったので、**同じ人でも番号が違った**。照会は成功し、
 * 答え (`linked: false`) も嘘ではなく、ただ噛み合わないだけ — だからログにも
 * エラーが出ず、2026-07 以降 52 commit を費やしても本番の連携は一度も成立しなかった。
 *
 * 2026-08-25、本番 OA と同一プロバイダ (Elxea / `2004600331`) 配下に LINE Login
 * チャネル `2011239425` と LIFF `2011239425-jjC59bI7` を新設し、そちらへ切り替えた。
 * 以後「ログイン・連携・台帳」の全経路が同一プロバイダの userId を使う。
 *
 * ## このモジュールが持つ責務
 *
 *   1. ログイン認可 URL に載せる **scope** を 1 か所で決める（email の可否を含む）
 *   2. **名前空間ガード** — 環境変数に入っているチャネル ID 群が食い違っていないかを
 *      機械的に検査する。食い違いは「連携が永久に成立しない」に直結するのに、
 *      **症状が沈黙**（照会は 200 で返り、`linked:false` になるだけ）なので、
 *      検査が無いと誰も気付けない。現状コード上に一致を保証する検査は一つも無かった
 *
 * ## なぜ「プロバイダが同じか」を実行時に確かめないのか
 *
 * 確かめられないから。プロバイダ ID は LINE Developers Console にしか無く、
 * ランタイムの API では引けない。代わりに **ランタイムで確かめられる代理指標**を
 * 全部確かめる:
 *
 *   - `AUTH_LINE_ID`（ログイン）/ `LINE_LOGIN_CHANNEL_ID` / `LINE_LIFF_CHANNEL_ID`
 *     （連携・LIFF）が**同一の 1 チャネル**を指していること
 *   - `NEXT_PUBLIC_LIFF_ID` の**前半（= チャネル ID）**がそれと一致すること
 *     （LIFF ID は `{channelId}-{suffix}` という形をしているので、これは実際に検査できる）
 *
 * 3 本の env が割れている状態は、まさに旧構成が壊れていた形そのものである。
 */
import { readSecretEnvTrimmed } from "@/lib/env";

/**
 * ログイン認可で常に要求する scope。
 *
 * `openid` は id_token を受け取るために必須（`/api/line-callback` は id_token の
 * 検証を**ゲート**にしており、無ければログインが成立しない）。`profile` は
 * displayName の取得に要る。
 */
const BASE_SCOPES: readonly string[] = ["profile", "openid"];

/**
 * `email` scope を要求してよいか。
 *
 * ## なぜ既定で要求しないのか（fail-soft）
 *
 * LINE の **メールアドレス取得権限は、チャネルごとに個別申請・個別承認**である。
 * 承認されていないチャネルに `scope=email` を投げると、LINE は認可の段階で拒む —
 * つまり **ログインが丸ごと落ちる**。旧チャネル (2009473839) は承認済みだったが、
 * 2026-08-25 に新設した `2011239425` は申請中で、コンソール上は "Unapplied" である。
 *
 * ここでチャネル切替と同時に `email` を要求し続けると、「連携を直すための変更で
 * ログインが全滅する」という最悪の壊し方になる。よって **既定は要求しない**。
 *
 * email が無くて困るのは `POST /api/identity/link-line` に渡す `email` が `null` に
 * なることだけで、cx-agent 側はもともと `email` を任意として受ける。**連携の成立に
 * email は要らない**（正本は `line_user_id` × `shopify_customer_id`）。
 *
 * ## 承認されたらどうするか
 *
 * Vercel の env に `LINE_LOGIN_EMAIL_SCOPE=enabled` を足すだけでよい。コードの
 * 変更もデプロイも要らない — 承認は LINE 側の都合でいつ降りるか分からないため、
 * 「降りた日に env を 1 本足せば有効になる」形にしてある。
 */
export function isEmailScopeEnabled(): boolean {
  const raw = readSecretEnvTrimmed(process.env.LINE_LOGIN_EMAIL_SCOPE);
  return raw === "enabled";
}

/**
 * ログイン認可 URL の `scope` パラメータ値。
 *
 * 2 つの init 経路（`/api/line-login` と `/api/line-login/init`）が別々に文字列を
 * 持っていると、片方だけ直して片方が残る。実際、この 2 本は同じ
 * `"profile openid email"` を別々に書いていた。1 か所に寄せる。
 */
export function loginScopeParam(): string {
  const scopes = [...BASE_SCOPES];
  if (isEmailScopeEnabled()) scopes.push("email");
  return scopes.join(" ");
}

/**
 * ログイン認可 URL の `bot_prompt`。
 *
 * ## なぜ戻せるようになったのか
 *
 * `bot_prompt` は「ログインついでに公式アカウントを友だち追加してもらう」パラメータで、
 * **Login チャネルに公式アカウントが紐付いている**ことが前提になる。2026-04-13 に
 * これを外したのは、旧 Login チャネルに紐付けられる OA がテスト用 `@426vlcyb` しか
 * 無かったからである（本番 OA は別プロバイダにあり、選択肢に出てこなかった）。
 *
 * 新チャネル `2011239425` は本番 OA `@307tzhkw` を紐付け済みなので、この前提は
 * 解消した。友だち追加はただの親切ではなく、**Account Link（LINE トーク内からの
 * 連携）と配信が届く条件**そのものなので、既定で戻す。
 *
 * 値を env で上書きできるようにしてあるのは、体験上の判断（追加画面を挟むかどうか）
 * がコードの再デプロイ無しで変えられるようにするため。`LINE_LOGIN_BOT_PROMPT=off`
 * でパラメータ自体を送らない。
 */
export function loginBotPrompt(): "aggressive" | "normal" | null {
  const raw = readSecretEnvTrimmed(process.env.LINE_LOGIN_BOT_PROMPT);
  if (raw === "off") return null;
  if (raw === "normal") return "normal";
  return "aggressive";
}

/** 名前空間ガードの検査結果。 */
export type ChannelNamespaceCheck =
  | { ok: true; channelId: string }
  /**
   * 検査できなかった。**不一致ではない。**
   *
   * 連携用の env を持たないデプロイ（プレビュー等）で「不一致」と鳴らすと、
   * 本物の不一致が埋もれる。「設定が無い」と「設定が食い違う」は別の事実として扱う。
   */
  | { ok: false; reason: "not-configured"; missing: string[] }
  | { ok: false; reason: "mismatch"; detail: string };

/** LIFF ID (`{channelId}-{suffix}`) からチャネル ID 部分を取り出す。形が違えば `null`。 */
export function channelIdFromLiffId(liffId: string | undefined): string | null {
  const trimmed = readSecretEnvTrimmed(liffId);
  if (!trimmed) return null;
  const [channelId, ...rest] = trimmed.split("-");
  if (!channelId || rest.length === 0) return null;
  if (!/^\d+$/.test(channelId)) return null;
  return channelId;
}

/**
 * 「ログインで得る ID と、台帳を引く ID が同じ名前空間か」を、ランタイムで確かめられる
 * 範囲で検査する（M-0 の恒久ガード）。
 *
 * 検査するのは 4 本:
 *
 *   - `AUTH_LINE_ID`          … ログインの `client_id`。ここから来る userId で台帳を引く
 *   - `LINE_LOGIN_CHANNEL_ID` … 同一チャネルの別名（歴史的経緯で 2 本ある）
 *   - `LINE_LIFF_CHANNEL_ID`  … 連携（P2 / LIFF）の `client_id`。台帳に書く側
 *   - `NEXT_PUBLIC_LIFF_ID`   … LIFF アプリ ID。前半がチャネル ID
 *
 * **1 つでも他と違えば、その差はそのまま「引けない連携」になる。** 旧構成では
 * 書く側と読む側が別チャネルで、しかも別プロバイダだった。
 *
 * 未設定のものは検査から外す（`not-configured`）。「無い」を「違う」に丸めない。
 */
export function checkChannelNamespace(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChannelNamespaceCheck {
  const candidates: Array<{ name: string; value: string | null }> = [
    { name: "AUTH_LINE_ID", value: readSecretEnvTrimmed(env.AUTH_LINE_ID) ?? null },
    {
      name: "LINE_LOGIN_CHANNEL_ID",
      value: readSecretEnvTrimmed(env.LINE_LOGIN_CHANNEL_ID) ?? null,
    },
    {
      name: "LINE_LIFF_CHANNEL_ID",
      value: readSecretEnvTrimmed(env.LINE_LIFF_CHANNEL_ID) ?? null,
    },
    {
      name: "NEXT_PUBLIC_LIFF_ID",
      value: channelIdFromLiffId(env.NEXT_PUBLIC_LIFF_ID),
    },
  ];

  const present = candidates.filter((c): c is { name: string; value: string } =>
    Boolean(c.value),
  );
  const missing = candidates.filter((c) => !c.value).map((c) => c.name);

  /* 1 本しか無いと「一致」も「不一致」も言えない。比較には最低 2 本要る。 */
  if (present.length < 2) {
    return { ok: false, reason: "not-configured", missing };
  }

  const expected = present[0].value;
  const divergent = present.filter((c) => c.value !== expected);
  if (divergent.length > 0) {
    /* 詳細に**チャネル ID を載せる**。これは秘密ではなく（認可 URL に平文で載る
       公開値）、載せないと「どれとどれが違うのか」が分からず直せない。 */
    const detail = present.map((c) => `${c.name}=${c.value}`).join(" / ");
    return { ok: false, reason: "mismatch", detail };
  }

  return { ok: true, channelId: expected };
}
