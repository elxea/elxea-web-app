/**
 * お気に入りの種類 (kind) と、種類ごとの並べ方の唯一の正本。
 *
 * お気に入りは Firestore の 1 コレクションに `type` 付きで混ざって入っている。
 * 画面はそれを **種類別に分けて** 出す (Setaka 要望 2026-08-25)。種類が増えたとき
 * (例: 生産者を「お気に入り」に足す) に触る場所を 1 か所に閉じるため、
 *
 *   - どんな種類があるか            … `FAVORITE_KINDS`
 *   - 種類ごとの遷移先・文言キー    … `FAVORITE_KIND_META`
 *
 * だけをここに持つ。種類を足す手順は「`FAVORITE_KINDS` に 1 語足す →
 * `FAVORITE_KIND_META` に 1 エントリ足す (足さないと型エラーになる) →
 * `messages/*.json` に文言を足す」の 3 手で閉じる。
 * 画面側 (マイページ本体 / お気に入り一覧) はこの配列を回すだけなので、
 * 「片方の画面にだけ種類を足し忘れる」事故が起きない。
 *
 * ## サーバ側 (API の受け口 / Firestore の型) もここから導く
 *
 * 以前は 4 手目に「API の zod enum に足す」があり、同じ語の列を
 * `FAVORITE_KINDS` / `lib/firebase/types.ts` の `FavoriteType` /
 * `app/api/user/favorites/route.ts` の `z.enum([...])` の **3 か所が独立に**
 * 持っていた。足し忘れると「画面には節が出るのに、保存しようとすると 400 が
 * 返る」という、症状から原因が遠い壊れ方をする。いまは後ろ 2 つをこの
 * `FAVORITE_KINDS` から導出しているので、ここに 1 語足せば受け口も型も
 * 自動で追従する (F4 / QA 指摘 2026-08-25)。
 *
 * 保存されている値は Firestore の生ドキュメント (`...doc.data()`) なので型が緩い。
 * 正規化 (`normalizeFavorites`) をここで一度だけ行い、以降は `FavoriteEntry` で扱う。
 */

/**
 * お気に入りにできるものの種類。**API 側 (`FavoriteType` / zod) はここから導く**
 * ので、この配列がサービス全体の唯一の正本。
 *
 * 並びは一覧ページ (/account/favorites) の節の並びでもある。
 */
export const FAVORITE_KINDS = ["product", "article", "person"] as const;

export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

type FavoriteKindMeta = {
  /** 詳細ページの基底パス (locale 抜き)。`href` の組み立てに使う。 */
  basePath: string;
  /**
   * 0 件のときに出す「探しに行く」導線の遷移先 (locale 抜き)。
   *
   * `basePath` と別に持つのは、**詳細ページはあっても一覧ページが無い種類がある**
   * ため。人 (`/people/[slug]`) がそれで、`/people` という一覧は実装されておらず
   * (導線は読みものの著者名から入る)、`basePath` をそのまま導線にすると 404 へ
   * 送ることになる。実在するページだけを指す。
   */
  browsePath: string;
  /** 節見出しの文言キー (`messages/*.json` の `account.*`)。 */
  headingKey: string;
  /** その種類が 0 件のときの文言キー。 */
  emptyKey: string;
  /** カード左上の種類ラベルの文言キー。 */
  labelKey: string;
  /** 0 件のときに出す「探しに行く」導線のラベル (`common.*` のキー)。 */
  browseLabelKey: string;
  /**
   * マイページ本体の「続き」(抜粋 6 枚) に出すときの種類の優先順位 (小さいほど先)。
   *
   * 抜粋は枚数が限られるので、並べる順で「その種類が 1 枚も出ない」が起きる。
   * どの種類を先に見せるかは表示の判断なので、`FAVORITE_KINDS` (= データの並び)
   * とは別に持つ。`Record<FavoriteKind, …>` の一部なので、**種類を足すとここも
   * 埋めないと型エラーになる** = 新しい種類が抜粋から黙って漏れることが無い。
   */
  continueRank: number;
};

/**
 * 種類ごとの遷移先と文言キー。**文言そのものは持たない** (キーだけ)。
 * `Record<FavoriteKind, …>` なので `FAVORITE_KINDS` に足すとここが型エラーになる。
 */
export const FAVORITE_KIND_META: Record<FavoriteKind, FavoriteKindMeta> = {
  product: {
    basePath: "/products",
    browsePath: "/products",
    headingKey: "favoriteProducts",
    emptyKey: "noFavoriteProducts",
    labelKey: "favoriteKindProduct",
    browseLabelKey: "products",
    continueRank: 2,
  },
  article: {
    basePath: "/journal",
    browsePath: "/journal",
    headingKey: "favoriteArticles",
    emptyKey: "noFavoriteArticles",
    labelKey: "favoriteKindArticle",
    browseLabelKey: "journal",
    continueRank: 0,
  },
  /**
   * 人 (作り手・つくり手を訪ねた記事の主・聞き手など `/people/[slug]` に載る人)。
   *
   * `browsePath` が `/journal` なのは上記のとおり `/people` 一覧が無いため。
   * 人のページへは読みものの著者名から入るので、0 件のときの導線も読みものへ送る。
   * `continueRank` は読みものの次 — 人のページは読みものの延長で見るものなので、
   * 商品より読みもの側に寄せる。
   */
  person: {
    basePath: "/people",
    browsePath: "/journal",
    headingKey: "favoritePeople",
    emptyKey: "noFavoritePeople",
    labelKey: "favoriteKindPerson",
    browseLabelKey: "journal",
    continueRank: 1,
  },
};

/**
 * 「続き」(マイページ本体の抜粋) に出す種類の順。`continueRank` の昇順。
 *
 * 呼び出し側が並びを自前で書かないための唯一の出口。ここを経由する限り、
 * 種類を足したときに抜粋から漏れることが無い。
 */
export const FAVORITE_CONTINUE_ORDER: readonly FavoriteKind[] = [...FAVORITE_KINDS].sort(
  (a, b) => FAVORITE_KIND_META[a].continueRank - FAVORITE_KIND_META[b].continueRank
);

/**
 * 一覧ページで 1 種類あたりに描く上限。
 *
 * 「すべて出す」が要望だが、無制限に描くと件数の多い人でページが重くなる
 * (Firestore 側は全件返す)。実利用の桁 (数十件) を大きく超える 100 を上限にし、
 * 超えた分は出さない。ページネーションは件数が実際にこの桁へ届いてから入れる。
 */
export const FAVORITES_KIND_LIMIT = 100;

/** 正規化後の 1 件。画面はこれだけを見る。 */
export type FavoriteEntry = {
  /** Firestore のドキュメント id。解除操作の楽観更新のキーにも使う。 */
  id: string;
  kind: FavoriteKind;
  /** 商品 handle / 記事 slug。解除 API (DELETE) が要求する識別子。 */
  targetId: string;
  title: string;
  imageUrl: string | null;
  /** ISO8601。取れないことがある (旧データ)。 */
  createdAt: string | null;
  /** 詳細ページへの内部リンク (locale 抜き)。 */
  href: string;
};

/** 種類 1 つ分のまとまり。0 件でも「その種類の枠」は残す (何が空かを見せる)。 */
export type FavoriteGroup = {
  kind: FavoriteKind;
  items: FavoriteEntry[];
};

/** Firestore の生ドキュメント (型が緩いので受け側で絞る)。 */
export type FavoriteInput = {
  id?: string;
  type?: unknown;
  targetId?: unknown;
  title?: unknown;
  imageUrl?: unknown;
  createdAt?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toKind(value: unknown): FavoriteKind | null {
  const kind = str(value);
  return kind !== null && (FAVORITE_KINDS as readonly string[]).includes(kind)
    ? (kind as FavoriteKind)
    : null;
}

/** 詳細ページへの内部リンク。種類ごとの基底パスは `FAVORITE_KIND_META` が正本。 */
export function favoriteHref(kind: FavoriteKind, targetId: string): string {
  return `${FAVORITE_KIND_META[kind].basePath}/${targetId}`;
}

/**
 * 1 件を指す鍵。**サーバとブラウザで同じ綴りを使う**ための唯一の口。
 *
 * ブラウザ側の倉庫 (`lib/favorites/client-store.ts`) はこの鍵の集合で
 * 「何が登録済みか」を持ち、マイページはサーバで数えた一覧を同じ鍵に直して
 * 初期値として渡す。両側が別々に組み立てると、綴りが 1 文字違うだけで
 * 「保存済みなのに未登録に見える」が起きるので、ここに 1 本化する。
 */
export function favoriteKey(kind: FavoriteKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

/** 生の一覧を鍵の配列にする (マイページがブラウザへ初期値を渡すとき用)。 */
export function favoriteKeysOf(favorites: FavoriteInput[]): string[] {
  return normalizeFavorites(favorites).map((entry) =>
    favoriteKey(entry.kind, entry.targetId)
  );
}

/**
 * 生データを `FavoriteEntry[]` に正規化する。
 *
 * 落とすもの: 見出しが無いもの / 知らない種類 / 遷移先を組めないもの (targetId 無し)。
 * 「押しても何も無いカード」を画面に出さないため、ここで捨てる。
 * 並びは入力順のまま (Firestore は createdAt 降順で返す)。
 */
export function normalizeFavorites(favorites: FavoriteInput[]): FavoriteEntry[] {
  return favorites
    .map((favorite, index): FavoriteEntry | null => {
      const kind = toKind(favorite.type);
      const targetId = str(favorite.targetId);
      const title = str(favorite.title);
      if (kind === null || targetId === null || title === null) return null;

      return {
        id: str(favorite.id) ?? `favorite-${index}`,
        kind,
        targetId,
        title,
        imageUrl: str(favorite.imageUrl),
        createdAt: str(favorite.createdAt),
        href: favoriteHref(kind, targetId),
      };
    })
    .filter((favorite): favorite is FavoriteEntry => favorite !== null);
}

/**
 * 種類別に分ける。**空の種類も返す** — 「商品のお気に入りは 0 件」という事実を
 * 見せるほうが、節ごと消えて「そもそも商品はお気に入りにできない」と読まれるより良い。
 * 並び順は `FAVORITE_KINDS` の順で固定 (表示順がデータの入り方で揺れない)。
 */
export function groupFavorites(
  entries: FavoriteEntry[],
  limit: number = FAVORITES_KIND_LIMIT
): FavoriteGroup[] {
  return FAVORITE_KINDS.map((kind) => ({
    kind,
    items: entries.filter((entry) => entry.kind === kind).slice(0, limit),
  }));
}

/** 総件数 (種類をまたいだ合計)。見出し脇の「n件」に使う。 */
export function countFavorites(groups: FavoriteGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/* -------------------------------------------------------------------------- */
/* 解除操作の楽観更新 (画面の状態遷移を純関数にして React の外でテストする)      */
/* -------------------------------------------------------------------------- */

/** 1 件を取り除く。種類の枠 (空になったグループ) は残す。 */
export function removeFavoriteFromGroups(
  groups: FavoriteGroup[],
  id: string
): FavoriteGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.id !== id),
  }));
}

/**
 * 取り除いた 1 件を **元の位置に** 戻す (解除 API が失敗したときの復元)。
 *
 * 末尾に足すと、失敗しただけなのに並びが変わって「解除できたのに戻ってきた」ように
 * 見える。取り除く前の添字を持ち回って同じ場所へ挿し直す。
 */
export function insertFavoriteIntoGroups(
  groups: FavoriteGroup[],
  entry: FavoriteEntry,
  index: number
): FavoriteGroup[] {
  return groups.map((group) => {
    if (group.kind !== entry.kind) return group;
    if (group.items.some((item) => item.id === entry.id)) return group;
    const items = [...group.items];
    items.splice(Math.max(0, Math.min(index, items.length)), 0, entry);
    return { ...group, items };
  });
}

/** その 1 件が、いま自分の種類のなかで何番目か (復元位置の記録用)。 */
export function indexOfFavorite(groups: FavoriteGroup[], entry: FavoriteEntry): number {
  const group = groups.find((candidate) => candidate.kind === entry.kind);
  const index = group?.items.findIndex((item) => item.id === entry.id) ?? -1;
  return index < 0 ? 0 : index;
}
