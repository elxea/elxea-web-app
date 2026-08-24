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
 * `messages/*.json` に文言を足す → API の zod enum に足す」の 4 手で閉じる。
 * 画面側 (マイページ本体 / お気に入り一覧) はこの配列を回すだけなので、
 * 「片方の画面にだけ種類を足し忘れる」事故が起きない。
 *
 * 保存されている値は Firestore の生ドキュメント (`...doc.data()`) なので型が緩い。
 * 正規化 (`normalizeFavorites`) をここで一度だけ行い、以降は `FavoriteEntry` で扱う。
 */

/** お気に入りにできるものの種類。API 側 (`FavoriteType`) と同じ語を使う。 */
export const FAVORITE_KINDS = ["product", "article"] as const;

export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

type FavoriteKindMeta = {
  /** 詳細ページの基底パス (locale 抜き)。`href` の組み立てに使う。 */
  basePath: string;
  /** 節見出しの文言キー (`messages/*.json` の `account.*`)。 */
  headingKey: string;
  /** その種類が 0 件のときの文言キー。 */
  emptyKey: string;
  /** カード左上の種類ラベルの文言キー。 */
  labelKey: string;
  /** 0 件のときに出す「探しに行く」導線のラベル (`common.*` のキー)。 */
  browseLabelKey: string;
};

/**
 * 種類ごとの遷移先と文言キー。**文言そのものは持たない** (キーだけ)。
 * `Record<FavoriteKind, …>` なので `FAVORITE_KINDS` に足すとここが型エラーになる。
 */
export const FAVORITE_KIND_META: Record<FavoriteKind, FavoriteKindMeta> = {
  product: {
    basePath: "/products",
    headingKey: "favoriteProducts",
    emptyKey: "noFavoriteProducts",
    labelKey: "favoriteKindProduct",
    browseLabelKey: "products",
  },
  article: {
    basePath: "/journal",
    headingKey: "favoriteArticles",
    emptyKey: "noFavoriteArticles",
    labelKey: "favoriteKindArticle",
    browseLabelKey: "journal",
  },
};

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
