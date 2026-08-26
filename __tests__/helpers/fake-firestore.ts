/**
 * インメモリの偽 Firestore。
 *
 * ## なぜ共有するのか
 *
 * 偽 Firestore は `identity-merge.test.ts` と `link-unlink-data-lifecycle.test.ts`
 * に 1 つずつあり、どちらも `collection().add()` しか実装していなかった。合体が
 * `doc(id).set()` と `db.doc(path)` も使うようになった時点で、**2 つの偽物を
 * 別々に育てる**のは、実装のどちら側がどこまで真似できているかを 2 か所で
 * 覚えておく作業になる。偽物がずれると、テストは通るのに本番だけ落ちる。
 * よって「本物の API のどこを真似ているか」を 1 か所に閉じる。
 *
 * ## 何を真似ているか（合体・お気に入り・解除が実際に使う面だけ）
 *
 *   - `db.collection(path)` … `get` / `add` / `where` / `limit` / `orderBy` / `doc`
 *   - `db.collection(path).doc(id)` … `get` / `set`
 *   - `db.doc(path)` … `get` / `set(data, {merge})` / `update` / `delete`
 *   - `snap.docs[i].ref.delete()`
 *
 * 保存は「コレクションパス → ドキュメント ID → 中身」の 1 つの Map に寄せて
 * ある。`db.doc("users/123")` はパスの末尾を ID として切り出すので、
 * `db.collection("users").doc("123")` と**同じドキュメント**を指す（本物と同じ）。
 * 別々の入れ物にすると、片方から書いてもう片方から読めない偽物ができる。
 *
 * ## E2E（Ring 2）でも同じ偽物を使う
 *
 * `e2e/line-linkage-flow.spec.ts` の dev サーバーは、この偽 Firestore を
 * `instrumentation.ts` から `getAdminFirestore()` に差し込んで動く
 * （`lib/firebase/admin.ts` の「E2E 用の差し込み口」節）。単体テストと E2E で
 * 偽物を 2 つ持つと、どちらが本物にどこまで似ているかを 2 か所で覚える羽目になり、
 * 「単体は通るのに E2E だけ落ちる（逆もある）」が起きる。**偽物は 1 つ**にする。
 *
 * ## 真似ていないもの
 *
 * トランザクション / バッチ / サブコレクションの自動列挙 / 複合インデックスの
 * 制約。合体・お気に入り・解除はどれも使わないので、あえて実装しない（使えない
 * ことがテストで見えるほうが安全）。`FieldValue.delete()` だけは
 * `unlinkLineUser` が使うので `update` の中で解釈する（下記）。
 */
import type { Firestore } from "firebase-admin/firestore";

export type DocData = Record<string, unknown>;

/** コレクションパス → そこに置くドキュメントの配列（ID は自動採番）。 */
export type Seed = Record<string, DocData[]>;

export type FakeFirestoreHooks = {
  /** throw して「コピーが失敗した」を作る（`add` と `doc().set()` の両方）。 */
  beforeWrite?: (path: string, data: DocData) => void;
  /** throw して「コピー成功後の削除が失敗した」を作る。 */
  beforeDelete?: (path: string, id: string) => void;
  /**
   * true を返すと、書き込みは解決するのに**着地しない**（検証不能なコピー）。
   * 「ack されたから消してよい」と「読み戻せたから消してよい」の差を撃つ。
   */
  dropWrite?: (path: string, data: DocData) => boolean;
  /**
   * 1 往復にかかる時間（ms）。既定 0。
   *
   * ## なぜ偽物が「遅さ」まで真似る必要があるのか
   *
   * 本番の Firestore は `asia-northeast1`、合体を走らせる関数は Vercel の
   * `iad1` にある。**1 往復ごとに太平洋を横断**していて、往復 170〜200ms する。
   * 往復の「回数」ではなく「直列に並んだ回数」がそのまま待ち時間になる。
   *
   * 2026-08-25 の本番障害（連携 callback が 20.1 秒 = 認可の承認後に真っ白な
   * 画面が 20 秒）はこれが原因だったが、**往復が即座に解決する偽物では
   * どのテストも落ちなかった**。中身が正しいことだけを見ていて、待ち方を
   * 見ていなかった。ここに遅延と同時実行数の観測を置くことで、「直列に戻す」
   * 変更が `stats.maxInFlight` の低下として見える。
   */
  latencyMs?: number;
};

function splitDocPath(fullPath: string): { colPath: string; id: string } {
  const at = fullPath.lastIndexOf("/");
  return { colPath: fullPath.slice(0, at), id: fullPath.slice(at + 1) };
}

/**
 * `FieldValue.delete()` の番人かどうか。
 *
 * `firebase-admin` を import して同一性で比べる手もあるが、この偽物は本番の SDK に
 * 依存しないまま保ちたい（依存すると、SDK の初期化に必要な資格情報が無い環境で
 * 単体テストが落ちうる）。実体は `DeleteTransform` という 1 つのクラスなので、
 * コンストラクタ名で見分ける。判別を外すと「消したはずのフィールドが
 * `{}` として残る」という、本物では起きない状態を作ってしまう。
 */
function isDeleteSentinel(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "DeleteTransform"
  );
}

/** `orderBy` の比較。Date / number / string を横並びに扱う。 */
function compareValues(a: unknown, b: unknown): number {
  const norm = (v: unknown): number | string => {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number" || typeof v === "string") return v;
    return "";
  };
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

export function createFakeFirestore(seed: Seed = {}, hooks: FakeFirestoreHooks = {}) {
  const store = new Map<string, Map<string, DocData>>();
  let counter = 0;

  /* 往復の観測。
       `operations`  総往復数
       `maxInFlight` 同時に開いていた往復の最大数（1 なら完全に直列）
       `waves`       **直列に並んだ段数**（下記） */
  const stats = { operations: 0, maxInFlight: 0, waves: 0 };
  let inFlight = 0;

  /** 1 往復ぶんの「行って帰ってくる」を挟む。すべての非同期 API がこれを通る。 */
  async function roundTrip<T>(run: () => T): Promise<T> {
    stats.operations += 1;
    /* 走っている往復がゼロの状態から 1 本目が開くたびに 1 段。つまり
       「前の往復が返ってこないと次を投げられない」箇所の数を数えている。
       本番の待ち時間は往復の**総数**ではなく、この段数 × 1 往復の時間で決まる
       （Firestore は asia-northeast1 / 関数は iad1 で 1 往復 170〜200ms）。

       ## なぜ壁時計ではなくこれを数えるのか（QA 指摘 2026-08-25）

       以前この観測は `Date.now()` の差分だった。だが偽物の遅延は実タイマーな
       ので、機械が他の作業で混んでいると測定値が桁で揺れる。判定が「変更の
       中身」ではなく「そのとき機械が空いていたか」で決まるテストは、いずれ
       無視されて意味を失う。段数は**約束の構造そのもの**なので、同じコードなら
       何度走らせても同じ数になり、直列に戻せば必ず増える。 */
    if (inFlight === 0) stats.waves += 1;
    inFlight += 1;
    if (inFlight > stats.maxInFlight) stats.maxInFlight = inFlight;
    try {
      const latency = hooks.latencyMs ?? 0;
      /* 0ms でも 1 tick は挟む。挟まないと「並行に投げた」ことがそもそも
         観測できない（同期に解決してしまい inFlight が 1 を超えない）。
         **既定はマイクロタスク**であって `setTimeout(…, 0)` ではない:
         `vi.useFakeTimers()` を使うテスト（連携キャッシュの TTL 等）では
         タイマーが進まないので、0ms のつもりが永久に解決しなくなる。 */
      if (latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, latency));
      } else {
        await Promise.resolve();
      }
      return run();
    } finally {
      inFlight -= 1;
    }
  }

  const colOf = (path: string) => {
    let col = store.get(path);
    if (!col) {
      col = new Map();
      store.set(path, col);
    }
    return col;
  };

  for (const [path, docs] of Object.entries(seed)) {
    for (const data of docs) colOf(path).set(`seed-${++counter}`, { ...data });
  }

  /** 1 ドキュメントへの参照（`collection().doc()` と `db.doc()` の共通の実体）。 */
  function makeDocRef(colPath: string, id: string) {
    return {
      id,
      get() {
        return roundTrip(() => {
          const data = colOf(colPath).get(id);
          return {
            exists: data !== undefined,
            id,
            data: () => (data === undefined ? undefined : { ...data }),
          };
        });
      },
      set(data: DocData, options?: { merge?: boolean }) {
        return roundTrip(() => {
          hooks.beforeWrite?.(colPath, data);
          if (hooks.dropWrite?.(colPath, data)) return;
          const existing = options?.merge ? (colOf(colPath).get(id) ?? {}) : {};
          colOf(colPath).set(id, { ...existing, ...data });
        });
      },
      /**
       * 本物の `update` は「無いドキュメントには失敗する」「`FieldValue.delete()` の
       * フィールドは消える」の 2 点が `set(..., {merge:true})` と違う。どちらも
       * `unlinkLineUser` の挙動そのものなので、その 2 点だけ真似る。
       */
      update(data: DocData) {
        return roundTrip(() => {
          hooks.beforeWrite?.(colPath, data);
          const existing = colOf(colPath).get(id);
          if (existing === undefined) {
            throw new Error(`no document to update: ${colPath}/${id}`);
          }
          const next: DocData = { ...existing };
          for (const [field, value] of Object.entries(data)) {
            if (isDeleteSentinel(value)) delete next[field];
            else next[field] = value;
          }
          colOf(colPath).set(id, next);
        });
      },
      delete() {
        return roundTrip(() => {
          hooks.beforeDelete?.(colPath, id);
          colOf(colPath).delete(id);
        });
      },
    };
  }

  type Order = { field: string; direction: "asc" | "desc" };

  function makeQuery(
    path: string,
    clauses: [string, unknown][],
    limit: number | null,
    order: Order | null = null,
  ) {
    return {
      where(field: string, _op: string, value: unknown) {
        return makeQuery(path, [...clauses, [field, value] as [string, unknown]], limit, order);
      },
      limit(n: number) {
        return makeQuery(path, clauses, n, order);
      },
      /**
       * `getFavorites` が `orderBy("createdAt","desc")` を使う。並び順まで真似るのは、
       * E2E の「合体後にお気に入りが見える」が **一覧の中身** で判定するため。
       * 並べ替えを無視すると、本物なら落ちる順序の退行が見えない。
       */
      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        return makeQuery(path, clauses, limit, { field, direction });
      },
      doc(id: string) {
        return makeDocRef(path, id);
      },
      get() {
        return roundTrip(() => {
          let entries = [...colOf(path).entries()];
          for (const [field, value] of clauses) {
            entries = entries.filter(([, data]) => data[field] === value);
          }
          if (order) {
            const sign = order.direction === "desc" ? -1 : 1;
            entries = [...entries].sort(
              ([, a], [, b]) => sign * compareValues(a[order.field], b[order.field]),
            );
          }
          if (limit !== null) entries = entries.slice(0, limit);
          return {
            empty: entries.length === 0,
            docs: entries.map(([id, data]) => ({
              id,
              data: () => ({ ...data }),
              ref: makeDocRef(path, id),
            })),
          };
        });
      },
      add(data: DocData) {
        return roundTrip(() => {
          hooks.beforeWrite?.(path, data);
          if (hooks.dropWrite?.(path, data)) return { id: "dropped" };
          const id = `added-${++counter}`;
          colOf(path).set(id, { ...data });
          return { id };
        });
      },
    };
  }

  const db = {
    collection: (path: string) => makeQuery(path, [], null),
    doc: (fullPath: string) => {
      const { colPath, id } = splitDocPath(fullPath);
      return makeDocRef(colPath, id);
    },
  } as unknown as Firestore;

  return {
    db,
    /**
     * 往復の観測値。`maxInFlight === 1` は「1 件ずつ順番に待った」の証拠で、
     * それがそのまま本番の待ち時間（= 白画面の長さ）になる。
     */
    stats,
    /** その棚の中身（順不同・ID は含まない）。 */
    contents: (path: string) => [...(store.get(path)?.values() ?? [])],
    /** その棚に今いくつ入っているか。中身（PII）ではなく件数で語りたいとき。 */
    count: (path: string) => store.get(path)?.size ?? 0,
    /** その棚のドキュメント ID 一覧（ID を保つ運び方の検証用）。 */
    ids: (path: string) => [...(store.get(path)?.keys() ?? [])],
    /** 1 ドキュメントの中身（`users/{key}` のようなドキュメント本体用）。 */
    docData: (fullPath: string) => {
      const { colPath, id } = splitDocPath(fullPath);
      const data = store.get(colPath)?.get(id);
      return data === undefined ? undefined : { ...data };
    },
    /** 「その画面に立ったときに書き込まれるもの」を模す直書き。 */
    seed: (path: string, data: DocData, id?: string) => {
      colOf(path).set(id ?? `seed-${++counter}`, { ...data });
    },
  };
}
