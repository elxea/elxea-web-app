"use client";

import { favoriteKey, type FavoriteKind } from "@/lib/account-favorites";

/**
 * お気に入りの登録状態を、ブラウザ側で **1 か所にまとめて持つ** ための小さな倉庫。
 *
 * ## 何を直しているか (Setaka 実機指摘 2026-08-25)
 *
 * 以前は、保存ボタンが 1 個ずつ自分で `/api/user/favorites?check=…` を叩いていた。
 * つまり **ページを開くたび・ボタンの数だけ** 往復が出る。しかもその往復が
 * 終わるまでボタンは「ブックマークの状態を確認しています」という別の文言を出し、
 * 幅の違う文字に置き換わるのでその場のレイアウトが動いていた。お客さまから見ると
 * 「押せるようになるまで待たされ、しかも文字が動く」ボタンである。
 *
 * ここでは考え方を反対にする。**その人が何をお気に入りにしているかは 1 つの事実**
 * なので、1 回だけ取ってきて倉庫に置き、ボタンはそれを読むだけにする。
 *
 *   - 1 タブにつき **1 回**だけ一覧を取る (ボタンの数によらない)
 *   - 取った結果は `sessionStorage` に置くので、**ページを移っても取り直さない**
 *     (= 遷移直後の 1 枚目から状態が確定していて、待ち時間が無い)
 *   - 押した瞬間は倉庫を先に書き換える (楽観更新)。サーバが失敗したら元に戻す
 *
 * ## なぜサーバ側 (SSR) で確定させないのか
 *
 * 商品・読みもの・人のページは ISR (60 秒の再生成) で配信されていて、**全員に同じ
 * HTML を返している**。ここで cookie を読むとページ全体が「人ごとに毎回作り直す」
 * 描画に落ち、Shopify / Sanity への往復が全アクセスに乗る。お気に入りの状態を
 * 早く出すために、ページ本体の表示を遅くするのは割に合わない。
 * マイページ (`/account`) は元々人ごとの描画なので、そちらは**サーバが知っている
 * 一覧をそのまま倉庫の初期値として渡す** (`seed`) — つまり「SSR で確定できる場所は
 * SSR で確定させる」。両方の場所で待ち時間がゼロになる。
 *
 * ## 分からないことは分からないと言う (G3 / G4 の踏襲)
 *
 * 倉庫は 4 つの状態を持ち、**「読めていない」と「登録が無い」を混ぜない**。
 *
 *   - `signed-out` … ログインしていない。登録は無い、で確定してよい
 *   - `cold`       … まだ読んでいない (タブを開いて最初の 1 回だけ)
 *   - `ready`      … 読めた。`keys` が正しい
 *   - `error`      … 読めなかった。**「登録なし」に化けさせない**
 *
 * `cold` / `error` のまま押されたときは、書き込む前に必ず実体を確かめてから反転する
 * (`toggleFavorite`)。見た目を待たせない代わりに、**書き込みの向きだけは絶対に
 * 取り違えない**。
 */

export type FavoritesPhase = "signed-out" | "cold" | "ready" | "error";

export type FavoritesSnapshot = {
  phase: FavoritesPhase;
  /** 登録済みの鍵。`phase === "ready"` のときだけ意味を持つ。 */
  keys: ReadonlySet<string>;
};

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * サーバ描画時の値。**常に同じオブジェクトを返す**必要がある
 * (`useSyncExternalStore` は毎回新しい値を返すと無限に再描画する)。
 */
const SERVER_SNAPSHOT: FavoritesSnapshot = { phase: "cold", keys: EMPTY_KEYS };

let snapshot: FavoritesSnapshot = SERVER_SNAPSHOT;

const listeners = new Set<() => void>();

function publish(next: FavoritesSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeToFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFavoritesSnapshot(): FavoritesSnapshot {
  return snapshot;
}

export function getFavoritesServerSnapshot(): FavoritesSnapshot {
  return SERVER_SNAPSHOT;
}

/* -------------------------------------------------------------------------- */
/* ログイン判定 — 4 か所にコピーされていた 1 行をここに集める (D-12)            */
/* -------------------------------------------------------------------------- */

/**
 * ログインしているか。**判定はここ 1 か所**。
 *
 * 以前この 1 行は保存ボタン 4 実装すべてに複製されていた。だからセッションの
 * 扱いが変わると 4 か所が同時に壊れ、直すときも 4 か所を揃えて直す必要があった。
 *
 * 見ているのは非 httpOnly の旗 cookie だけで、これは**画面の出し分けのため**である。
 * 本当の認可はサーバ (`resolveIdentity()`) が持つ。旗が嘘でも API が 401 を返すだけで、
 * 他人の棚は開かない。
 */
export function isFavoritesAuthed(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.cookie.includes("shop_auth=1") ||
    document.cookie.includes("line_auth=1")
  );
}

/** どの入口でログインしているか。保存した一覧を人違いのまま使い回さないための指紋。 */
function authFingerprint(): string {
  if (typeof document === "undefined") return "";
  const shop = document.cookie.includes("shop_auth=1") ? "s" : "";
  const line = document.cookie.includes("line_auth=1") ? "l" : "";
  return `${shop}${line}`;
}

/* -------------------------------------------------------------------------- */
/* タブ内の持ち越し (sessionStorage)                                           */
/* -------------------------------------------------------------------------- */

/**
 * 保存先。**タブが閉じれば消える** `sessionStorage` を選んでいる。
 *
 * `localStorage` なら次の来訪でも即座に出せるが、共用端末で前の人の一覧が残る。
 * お気に入りは「その人が何を気に入っているか」という情報なので、端末に焼き付けない。
 * タブの中だけで持ち越せば、ページ遷移の待ち時間はゼロにできる。
 */
const CACHE_KEY = "elxea.favorites.v1";

type CachedShape = { auth: string; keys: string[] };

function readCache(): ReadonlySet<string> | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedShape;
    if (!parsed || typeof parsed.auth !== "string" || !Array.isArray(parsed.keys)) {
      return null;
    }
    /* ログインの入口が変わっていたら別人かもしれない。捨てて引き直す。 */
    if (parsed.auth !== authFingerprint()) return null;
    return new Set(parsed.keys.filter((key): key is string => typeof key === "string"));
  } catch {
    /* sessionStorage が使えない環境 (Safari のプライベート等) では単に持ち越さない。 */
    return null;
  }
}

function writeCache(keys: ReadonlySet<string>): void {
  try {
    const payload: CachedShape = { auth: authFingerprint(), keys: [...keys] };
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* 書けなくても動作は変わらない (次のページで取り直すだけ)。 */
  }
}

function clearCache(): void {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}

/* -------------------------------------------------------------------------- */
/* 取り込み                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 押下による書き込みの記録。`鍵 → { 望んだ値, 何番目の書き込みか }`。
 *
 * 通し番号を持つのは、**着地の順番がずれても正しい答えを選べるようにする**ため。
 * 一覧の取り込みは投げてから返るまでに秒単位の幅があり、その間に押された分は
 * 「取ってきた一覧」より新しい。真偽値だけでは「取り込みを投げた**後**の書き込みか」
 * が判らず、確定した保存が古い一覧に巻き戻される (記事の保存ボタンで実際に起きた事故)。
 *
 * 走行中だけでなく **着地後も残す**。書き込みが終わってから古い一覧が着地する
 * 順番が普通にありうるので、走行中だけ覚える作りでは同じ事故が残る。
 */
const localWrites = new Map<string, { value: boolean; seq: number }>();

/** 書き込みの通し番号 (単調増加・巻き戻さない)。 */
let writeSeq = 0;

let hydrating: Promise<void> | null = null;

/** 取り込みが 1 度でも走ったか (`seed` で満たされた場合も含む)。 */
let hydrated = false;

/**
 * 取ってきた一覧を反映する。
 *
 * @param issuedAtSeq その一覧を**取りに行った時点**の書き込み通し番号。これより後の
 *   書き込みは一覧に載っていないので、こちらを勝たせる。
 */
function applyServerKeys(
  serverKeys: ReadonlySet<string>,
  issuedAtSeq: number,
): void {
  const merged = new Set(serverKeys);
  for (const [key, write] of localWrites) {
    if (write.seq <= issuedAtSeq) continue;
    if (write.value) merged.add(key);
    else merged.delete(key);
  }
  hydrated = true;
  writeCache(merged);
  publish({ phase: "ready", keys: merged });
}

/**
 * サーバが既に知っている一覧を初期値として渡す (マイページなど人ごとに描く画面)。
 *
 * これが呼ばれた画面では**往復がゼロ**になり、1 枚目の描画から状態が確定している。
 */
export function seedFavoriteKeys(keys: Iterable<string>): void {
  applyServerKeys(new Set(keys), writeSeq);
}

/**
 * 一覧を 1 回だけ取り込む。2 回目以降は何もしない (タブにつき 1 往復)。
 *
 * 失敗しても例外は投げない。`error` に倒して「読めなかった」を残すだけで、
 * 「登録なし」には**化けさせない**。
 */
export function ensureFavoritesHydrated(): void {
  if (typeof window === "undefined") return;
  if (hydrating) return;

  if (!isFavoritesAuthed()) {
    clearCache();
    if (snapshot.phase !== "signed-out") {
      publish({ phase: "signed-out", keys: EMPTY_KEYS });
    }
    return;
  }

  /* 取りに行く**前**の通し番号を控える。返ってくるまでに押された分は、この一覧に
     載っていないので、着地時にこちらを勝たせる。 */
  const issuedAtSeq = writeSeq;

  hydrating = (async () => {
    try {
      const res = await fetch("/api/user/favorites", { credentials: "same-origin" });
      if (!res.ok) {
        /* 401 は「旗 cookie はあるがサーバは知らない」= 実質未ログイン。
           それ以外は読めなかっただけなので `error` に倒す。 */
        publish(
          res.status === 401
            ? { phase: "signed-out", keys: EMPTY_KEYS }
            : { phase: "error", keys: snapshot.keys },
        );
        return;
      }
      const data = (await res.json()) as { favorites?: unknown };
      if (!Array.isArray(data.favorites)) {
        publish({ phase: "error", keys: snapshot.keys });
        return;
      }
      const keys = new Set<string>();
      for (const raw of data.favorites) {
        const entry = raw as { type?: unknown; targetId?: unknown };
        if (typeof entry.type === "string" && typeof entry.targetId === "string") {
          keys.add(`${entry.type}:${entry.targetId}`);
        }
      }
      applyServerKeys(keys, issuedAtSeq);
    } catch {
      publish({ phase: "error", keys: snapshot.keys });
    }
  })();
}

/**
 * 1 件だけ実体を確かめる (倉庫がまだ読めていないまま押されたとき用)。
 *
 * 取れなければ `null`。**「未登録」と混同しない**。
 */
async function fetchOne(kind: FavoriteKind, targetId: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `/api/user/favorites?check=${encodeURIComponent(targetId)}&checkType=${kind}`,
      { credentials: "same-origin" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { favorited?: unknown };
    return data.favorited === true;
  } catch {
    return null;
  }
}

function setKey(key: string, value: boolean): void {
  const keys = new Set(snapshot.keys);
  if (value) keys.add(key);
  else keys.delete(key);
  if (snapshot.phase === "ready") writeCache(keys);
  publish({ ...snapshot, keys });
}

/**
 * 通信せずに 1 件の状態だけを倉庫に反映する。
 *
 * お気に入り一覧 (`/account/favorites`) の解除ボタンは、並び順を保った復元が要る
 * ので自前で楽観更新している。その画面と保存トグルが**同じ事実を別々に持つ**と、
 * 一覧で外した直後に商品ページへ移ったとき「保存済み」のままに見える。
 * 一覧側が結果をここへ伝えることで、倉庫が唯一の事実であり続ける。
 */
export function applyLocalFavorite(
  kind: FavoriteKind,
  targetId: string,
  value: boolean,
): void {
  if (typeof window === "undefined") return;
  const key = favoriteKey(kind, targetId);
  writeSeq += 1;
  localWrites.set(key, { value, seq: writeSeq });
  setKey(key, value);
}

/* -------------------------------------------------------------------------- */
/* 読み取り                                                                     */
/* -------------------------------------------------------------------------- */

/** 画面が知りたいこと。`unknown` は「まだ / もう分からない」。 */
export type FavoriteState = "saved" | "unsaved" | "unknown";

export function readFavoriteState(
  current: FavoritesSnapshot,
  kind: FavoriteKind,
  targetId: string,
): FavoriteState {
  if (current.phase === "signed-out") return "unsaved";
  if (current.phase === "ready") {
    return current.keys.has(favoriteKey(kind, targetId)) ? "saved" : "unsaved";
  }
  /* `cold` (まだ 1 回目が着いていない) / `error` (読めなかった)。
     ここで `unsaved` と言い切ると「登録済みなのに空アイコン」が黙って出る。 */
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* 書き込み                                                                     */
/* -------------------------------------------------------------------------- */

export type ToggleOutcome = "added" | "removed" | "unauthenticated" | "failed";

/**
 * 押されたときの一連の処理。**押した瞬間に倉庫を書き換える** (楽観更新)。
 *
 * 状態が確定していないまま押された場合だけ、書き込む前に 1 件を確かめる。
 * 「確認が終わるまで押せない」で待たせないための取り決めで、**反転の向きは
 * 必ず実体に合わせる**。
 */
export async function toggleFavorite(entry: {
  kind: FavoriteKind;
  targetId: string;
  title: string;
  imageUrl: string | null;
}): Promise<ToggleOutcome> {
  if (!isFavoritesAuthed()) return "unauthenticated";

  const key = favoriteKey(entry.kind, entry.targetId);

  let previous: boolean;
  const state = readFavoriteState(snapshot, entry.kind, entry.targetId);
  if (state === "unknown") {
    /* 1 件だけ確かめる。**走っている一覧の着地は待たない** — 一覧は重く
       (実測 450-787ms)、遅いときは秒単位で開いたままになる。待つ作りにすると
       「押しても何も起きない時間」がその一覧の遅さに引きずられる。
       1 件の確認 (実測 335-393ms) のほうが速く、しかも一覧と並行に走る。
       押した瞬間の反応はボタン側の進行表示が担う (監査 P1-2)。 */
    const resolved = await fetchOne(entry.kind, entry.targetId);
    if (resolved === null) return "failed";
    previous = resolved;
  } else {
    previous = state === "saved";
  }

  const next = !previous;

  writeSeq += 1;
  localWrites.set(key, { value: next, seq: writeSeq });
  setKey(key, next);

  try {
    const res = next
      ? await fetch("/api/user/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            type: entry.kind,
            targetId: entry.targetId,
            title: entry.title,
            imageUrl: entry.imageUrl,
          }),
        })
      : await fetch("/api/user/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ type: entry.kind, targetId: entry.targetId }),
        });

    if (!res.ok) throw new Error(`favorites write failed: ${res.status}`);

    /* 書けた。倉庫は既にこの値なので触らない。 */
    return next ? "added" : "removed";
  } catch {
    /* 失敗した。押す前に戻し、記録も「押す前の値」に更新する (番号は進めたまま —
       戻さないと、この巻き戻し自体が古い一覧に上書きされる)。 */
    writeSeq += 1;
    localWrites.set(key, { value: previous, seq: writeSeq });
    setKey(key, previous);
    return "failed";
  }
}

/* -------------------------------------------------------------------------- */
/* テスト用                                                                     */
/* -------------------------------------------------------------------------- */

export function __resetFavoritesStoreForTest(): void {
  snapshot = SERVER_SNAPSHOT;
  hydrating = null;
  hydrated = false;
  writeSeq = 0;
  localWrites.clear();
  listeners.clear();
  if (typeof window !== "undefined") clearCache();
}

/** タブに持ち越した一覧があれば、描画より前に読み込む (遷移直後のちらつき防止)。 */
export function primeFavoritesFromCache(): void {
  if (typeof window === "undefined") return;
  if (hydrated) return;
  if (!isFavoritesAuthed()) return;
  const cached = readCache();
  if (cached) {
    hydrated = true;
    publish({ phase: "ready", keys: cached });
  }
}

/* このモジュールが読み込まれた時点で、タブの持ち越しを先に反映しておく。
   最初の描画より前に走るので、ページを移った直後の 1 枚目から状態が確定する。 */
if (typeof window !== "undefined") primeFavoritesFromCache();
