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
 * ## 何を真似ているか（合体が実際に使う面だけ）
 *
 *   - `db.collection(path)` … `get` / `add` / `where` / `limit` / `doc`
 *   - `db.collection(path).doc(id)` … `get` / `set`
 *   - `db.doc(path)` … `get` / `set(data, {merge})` / `delete`
 *   - `snap.docs[i].ref.delete()`
 *
 * 保存は「コレクションパス → ドキュメント ID → 中身」の 1 つの Map に寄せて
 * ある。`db.doc("users/123")` はパスの末尾を ID として切り出すので、
 * `db.collection("users").doc("123")` と**同じドキュメント**を指す（本物と同じ）。
 * 別々の入れ物にすると、片方から書いてもう片方から読めない偽物ができる。
 *
 * ## 真似ていないもの
 *
 * トランザクション / バッチ / サブコレクションの自動列挙 / 複合インデックスの
 * 制約 / `FieldValue`。合体はどれも使わないので、あえて実装しない（使えない
 * ことがテストで見えるほうが安全）。
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
};

function splitDocPath(fullPath: string): { colPath: string; id: string } {
  const at = fullPath.lastIndexOf("/");
  return { colPath: fullPath.slice(0, at), id: fullPath.slice(at + 1) };
}

export function createFakeFirestore(seed: Seed = {}, hooks: FakeFirestoreHooks = {}) {
  const store = new Map<string, Map<string, DocData>>();
  let counter = 0;

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
      async get() {
        const data = colOf(colPath).get(id);
        return {
          exists: data !== undefined,
          id,
          data: () => (data === undefined ? undefined : { ...data }),
        };
      },
      async set(data: DocData, options?: { merge?: boolean }) {
        hooks.beforeWrite?.(colPath, data);
        if (hooks.dropWrite?.(colPath, data)) return;
        const existing = options?.merge ? (colOf(colPath).get(id) ?? {}) : {};
        colOf(colPath).set(id, { ...existing, ...data });
      },
      async delete() {
        hooks.beforeDelete?.(colPath, id);
        colOf(colPath).delete(id);
      },
    };
  }

  function makeQuery(path: string, clauses: [string, unknown][], limit: number | null) {
    return {
      where(field: string, _op: string, value: unknown) {
        return makeQuery(path, [...clauses, [field, value] as [string, unknown]], limit);
      },
      limit(n: number) {
        return makeQuery(path, clauses, n);
      },
      doc(id: string) {
        return makeDocRef(path, id);
      },
      async get() {
        let entries = [...colOf(path).entries()];
        for (const [field, value] of clauses) {
          entries = entries.filter(([, data]) => data[field] === value);
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
      },
      async add(data: DocData) {
        hooks.beforeWrite?.(path, data);
        if (hooks.dropWrite?.(path, data)) return { id: "dropped" };
        const id = `added-${++counter}`;
        colOf(path).set(id, { ...data });
        return { id };
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
