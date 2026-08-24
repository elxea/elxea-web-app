/**
 * ワンタップ連携の「意思」を、行きと帰りのあいだだけ運ぶ封筒（J-1 案A）。
 *
 * ## 何のためにあるのか
 *
 * LINE だけでログインしている人が「メールアドレスと連携する」を押すと、いったん
 * サイトを離れて Shopify のログインへ行き、戻ってくる。**戻ってきた時点では、
 * その人が連携するつもりで出て行ったのかどうかを知る手がかりが無い。**
 *
 * 手がかりが無いまま合体させるのが、旧実装が踏んでいた事故（B5）だった。
 * `line_uid` cookie が**同居しているだけ**を理由に合体していたので、共用端末に
 * 前の人の LINE セッションが残っていれば、その人のお気に入りが次の人の棚へ移った。
 *
 * G1 は「cookie の同居を意思の代わりにしない」と定める。**この封筒は同居ではなく
 * 意思そのもの**である — 押した瞬間にしか作られず、押した人の LINE にしか使えず、
 * 一度使えば消える。
 *
 * ## 緩和の幅を最小にする 3 条件（設計書 §3-4 の G1 緩和）
 *
 * | 条件 | 何を防ぐか |
 * |---|---|
 * | **短命**（10 分） | 放置された意思を後から拾われること |
 * | **1 回きり** | 1 度の意思が 2 度目の連携に流用されること |
 * | **LINE ID 束縛** | 別の LINE セッションに差し替えて使われること |
 *
 * 3 つ目が要。封筒の中には「押したときの LINE の人」が入っていて、帰ってきたときの
 * `line_uid` と**一致しなければ開かない**。共用端末で LINE が入れ替わっていたら、
 * 封筒はあっても使えない。つまり緩めたのは「意思の運び方」だけで、
 * **「本人でなくてよい」には一切していない**。
 *
 * ## なぜ署名ではなく暗号化か
 *
 * 中身に LINE の userId が入るため。`encryptToken` は AES-256-GCM（認証付き暗号）
 * なので、機密性と改竄検知を同時に得られる。署名だけだと userId が平文で cookie に載る。
 * `lib/line/link-flow.ts` の state 封緘と同じ判断。
 */
import { encryptToken, decryptToken } from "@/lib/shopify/customer";

/** cookie 名。`lib/auth/cookies.ts` のレジストリにも登録すること（未登録は test で落ちる）。 */
export const LINK_INTENT_COOKIE = "line_link_intent";

/**
 * 意思の有効期間。
 *
 * Shopify のログインを 1 往復するのに要る時間だけを与える。長くするほど
 * 「押したまま放置された意思」を後から拾える窓が広がる。既存の
 * `line_oauth_state` / `line_link_state` と同じ 10 分に揃える。
 */
export const LINK_INTENT_TTL_MS = 10 * 60 * 1000;

/** 封筒の中身。キーを 1 文字にしているのは cookie サイズを抑えるため。 */
type SealedIntent = {
  /** 押したときの、サーバ確定の LINE userId。 */
  u: string;
  /** 発行時刻（epoch ms）。 */
  t: number;
};

/** 開封の結果。理由を潰さないのは、呼び出し側がログに残せるようにするため。 */
export type OpenIntentResult =
  | { ok: true; lineUserId: string }
  | {
      ok: false;
      /**
       * - `absent`      … 封筒が無い（＝押していない。**これが通常**）
       * - `undecodable` … 復号・解釈できない（我々が発行したものではない / 壊れた）
       * - `expired`     … 10 分を過ぎた
       * - `not-bound`   … 封筒の LINE と、いまの LINE が違う（共用端末で入れ替わった）
       */
      reason: "absent" | "undecodable" | "expired" | "not-bound";
    };

/**
 * 意思を封緘する。
 *
 * @param lineUserId **サーバ側で検証済み**の LINE userId のみ
 *   （`line_uid` cookie の復号結果）。ブラウザ自己申告を封じてはならない —
 *   封じた瞬間、それが「意思」として通用してしまう。
 * @returns cookie に載せる文字列。封緘できなければ `null`（＝ワンタップを諦める）。
 */
export function sealLinkIntent(lineUserId: string, now: number = Date.now()): string | null {
  if (!lineUserId) return null;
  const payload: SealedIntent = { u: lineUserId, t: now };
  try {
    return encryptToken(JSON.stringify(payload));
  } catch {
    /* 鍵が無い等。ワンタップが使えないだけで、2 段階の導線は生きている。
       ここで throw すると、連携どころかマイページの表示ごと落ちる。 */
    return null;
  }
}

/**
 * 意思を開封し、**いまの LINE と束縛が取れているか**まで確かめる。
 *
 * 呼び出し側は、この関数が `ok: true` を返したときにだけ台帳を書いてよい。
 * それ以外はすべて「押していない」と同じ扱いにする（＝何も起きない）。
 *
 * @param sealed cookie から読んだ文字列（無ければ `undefined`）。
 * @param currentLineUserId いまのリクエストが持つ、**サーバ確定**の LINE userId。
 *   これが無い（LINE セッションを失っている）場合は束縛が確認できないので開かない。
 */
export function openLinkIntent(
  sealed: string | undefined,
  currentLineUserId: string | null,
  now: number = Date.now(),
): OpenIntentResult {
  if (!sealed) return { ok: false, reason: "absent" };

  let payload: SealedIntent;
  try {
    const raw = decryptToken(sealed);
    if (!raw) return { ok: false, reason: "undecodable" };
    const parsed = JSON.parse(raw) as Partial<SealedIntent>;
    if (typeof parsed?.u !== "string" || typeof parsed?.t !== "number") {
      return { ok: false, reason: "undecodable" };
    }
    payload = { u: parsed.u, t: parsed.t };
  } catch {
    return { ok: false, reason: "undecodable" };
  }

  if (!payload.u) return { ok: false, reason: "undecodable" };

  /* 期限。負の経過時間（時計のずれ・改竄）も期限切れ扱いにする — 未来から来た
     意思を有効にする理由が無い。 */
  const age = now - payload.t;
  if (age < 0 || age > LINK_INTENT_TTL_MS) return { ok: false, reason: "expired" };

  /* 束縛。ここが本丸。封筒があっても、いまの LINE が別人なら開かない。
     `currentLineUserId` が null（LINE セッションを失った）のときも開かない —
     束縛を確認できない以上、確認できたことにはできない。 */
  if (!currentLineUserId || currentLineUserId !== payload.u) {
    return { ok: false, reason: "not-bound" };
  }

  return { ok: true, lineUserId: payload.u };
}
