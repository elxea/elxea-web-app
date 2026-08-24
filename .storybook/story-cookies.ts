/**
 * story の中だけで完結する cookie 置き場。
 *
 * ## なぜ必要か (共有の cookie jar は story 間で漏れる)
 *
 * ログイン判定を `document.cookie` で行う部品がいくつかある
 * (`bookmark-button` / `favorite-toggle-button`)。その story は「ログイン済み」を
 * 装うために `document.cookie = "shop_auth=1"` を置き、後で消していた。
 *
 * ところが cookie は **オリジン単位** の入れ物で、iframe を分けても共有される。
 * vitest の browser mode は story ファイルを **並行** に走らせるので、片方の
 * ファイルが「ログイン済み」を置いている最中に、もう片方の「未ログイン」の story が
 * 描かれることがある。すると未ログインのはずの部品がログイン済みと判断し、
 * 実 API の無い story 環境で状態確認に失敗して別の見た目になる。
 *
 * 各 story が「自分で消してから描く」対策は **これを直せない** — 消した直後に
 * 別ファイルが置き直すため。走る順に依存して落ちたり落ちなかったりする
 * (実測 2026-08-25: 同じ木で 2 回連続実行し、1 回目だけ `Journal/BookmarkButton
 * > Logged Out` が落ちた)。
 *
 * ## 直し方
 *
 * 共有の入れ物を使うのをやめる。`document.cookie` をその iframe の中だけで
 * 差し替え、読み書きを手元の文字列に閉じる。どの story も他の story の cookie を
 * 見ないし、置いた cookie が外へ漏れない = 走る順に依存しなくなる。
 *
 * 使う側は `beforeEach` から戻り値 (後始末) をそのまま返す:
 *
 * ```ts
 * beforeEach: () => isolateCookies("shop_auth=1")
 * ```
 */

/** `name=value` の並び。属性 (`path` / `expires` 等) は持たない。 */
type Jar = Map<string, string>;

function serialize(jar: Jar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * 1 本の書き込みを反映する。
 *
 * 見るのは「消す指示かどうか」だけ (`expires` が過去 / `max-age=0`)。`path` や
 * `domain` は story では意味を持たない (どの story も同じ 1 ページで描かれる) ので
 * 無視する。ここで実装するのは本物の cookie の仕様ではなく、**story が必要とする
 * 分だけ**であることに注意 — 足りなくなったら足す。
 */
function apply(jar: Jar, input: string): void {
  const [pair, ...attributes] = input.split(";");
  const index = pair?.indexOf("=") ?? -1;
  if (!pair || index < 0) return;

  const name = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  if (name === "") return;

  const removed = attributes.some((attribute) => {
    const [key, raw = ""] = attribute.split("=");
    const lowered = key?.trim().toLowerCase();
    if (lowered === "max-age") return Number(raw.trim()) <= 0;
    if (lowered === "expires") {
      const at = Date.parse(raw.trim());
      return Number.isFinite(at) && at <= Date.now();
    }
    return false;
  });

  if (removed) jar.delete(name);
  else jar.set(name, value);
}

/**
 * `document.cookie` をこの iframe の中だけの入れ物に差し替える。
 *
 * @param initial 最初から入れておく cookie (`"shop_auth=1"` 等)。既定は空 = 未ログイン。
 * @returns 後始末。呼ぶと元の `document.cookie` に戻る。
 */
export function isolateCookies(initial = ""): () => void {
  const jar: Jar = new Map();
  for (const entry of initial.split(";")) {
    if (entry.trim() !== "") apply(jar, entry);
  }

  /* 差し替えを戻せるように元の定義を控える。`cookie` は普通 `document` 自身では
     なく `Document.prototype` に載っているので、**自前の定義だったかどうか**を
     覚えておき、後始末では元の場所に戻す (prototype 由来なら自分の定義を消すだけで
     prototype の本物が再び効く)。 */
  const own = Object.getOwnPropertyDescriptor(document, "cookie");

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => serialize(jar),
    set: (input: string) => apply(jar, String(input)),
  });

  return () => {
    delete (document as unknown as { cookie?: unknown }).cookie;
    if (own) Object.defineProperty(document, "cookie", own);
  };
}
