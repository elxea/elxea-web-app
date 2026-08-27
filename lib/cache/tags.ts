/**
 * @sot cache-tag-registry
 *
 * キャッシュの名札 (tag) の正本。**貼る側と剥がす側を 1 つの表で対にする**。
 *
 * ## なぜこの表が要るのか (憲章 R3「キャッシュは『対』でしか存在させない」)
 *
 * この表を作る前、Sanity の更新は本番に反映されていなかった。仕組みはこう
 * なっていた:
 *
 *   1. Sanity で記事を更新すると webhook が `/api/revalidate` を叩く
 *   2. ルートは `revalidateTag(body._type)` を実行する (例: `revalidateTag("article")`)
 *   3. `"article"` という名札の付いたキャッシュを Next が探す
 *   4. **そんな名札はアプリ内に 1 つも無い** ので、何も起きない
 *
 * Sanity を読む箇所は 60 か所あり、そのうち名札を付けていた箇所は 0 だった
 * (2026-08-27 実測)。つまり無効化の命令は確率ではなく **構造として 100%
 * 空振り**していた。剥がす側だけが存在し、貼る側が存在しない — 片側だけの
 * 装置は、動いていないことを誰にも知らせないまま動いていない。
 *
 * だから名札は「文字列を書く場所」ではなく **表** にする。貼る側 (読み取り
 * ゲートウェイ `sanity/lib/fetch.ts` の `cache: { tag }`) と剥がす側 (webhook の
 * `revalidateTag`) の双方がこの表からしか名前を取れないようにし、対応の欠落を
 * `__tests__/cache-tags-registry.test.ts` が機械で突合する。
 *
 * ## 表の読み方 — 「何を読んだか」と「何が変わったか」は別の軸
 *
 * 名札は **読み取り側の関心** (どのページ群が何を見ているか) で切る。
 * webhook が知らせてくるのは **書き込み側の事実** (どのドキュメント型が
 * 変わったか) で、この 2 つは 1 対 1 ではない。
 *
 * 例: カテゴリ一覧は記事の本数を数えて表示する (`CATEGORIES_WITH_COUNTS_QUERY`)。
 * だから **記事が 1 本増えるとカテゴリ一覧の表示も変わる**。読み取り 1 つに
 * 名札 1 枚 (`{ tag: CacheTag }` の型どおり)、無効化はそこから **扇形に広げる**
 * (`SANITY_TYPE_TO_TAGS`) — これが本表の設計。読み取り側に名札を複数持たせて
 * 参照関係を書き写す形にすると、参照が増えるたびに 60 か所を直すことになる。
 *
 * ## 名札を増やすとき
 *
 * `CACHE_TAGS` に足すだけでは通らない。突合テストが
 *   - その名札を実際に使っている読み取り (貼る側) があるか
 *   - その名札を剥がす `SANITY_TYPE_TO_TAGS` の行 (剥がす側) があるか
 * の両方を要求する。片側だけ足した名札は CI で落ちる。
 */

/**
 * Sanity のドキュメント型。webhook の `body._type` に載ってくる文字列と
 * **同じ綴り**でなければならない (Studio のスキーマ名がそのまま来る)。
 *
 * ここに無い型が webhook で飛んできた場合、それは「アプリが読んでいない型」で
 * あることを突合テストが保証する (テストは `sanity/lib/queries.ts` と `app/**`
 * の GROQ に出てくる `_type == "..."` を全て集め、この一覧との一致を検査する)。
 * だから未知の型に対して何も剥がさないのは、空振りではなく正しい無反応になる。
 */
export const SANITY_DOCUMENT_TYPES = [
  "article",
  "author",
  "category",
  "event",
  "farmer",
  "journal",
  "page",
  "playlist",
  "siteSettings",
  "tag",
  "teaMenu",
] as const;

export type SanityDocumentType = (typeof SANITY_DOCUMENT_TYPES)[number];

/**
 * キャッシュの名札の全語彙。読み取り側 (`sanityFetch({ cache: { tag } })`) が
 * 選べる値はここに挙がっているものだけで、型でそれを強制する。
 *
 * `sanity:` 接頭辞は出所を名前に残すためのもの。将来 Shopify 側にも名札を
 * 付けるときに、どの外部系の更新でどれが飛ぶのかを名前だけで見分けられる。
 */
export const CACHE_TAGS = [
  /** 記事本体を読む一切 (一覧・詳細・検索・関連・タグ別・カテゴリ別・著者別・商品別) */
  "sanity:articles",
  /** カテゴリの一覧・件数付き一覧 */
  "sanity:categories",
  /** タグの一覧・件数付き一覧 */
  "sanity:tags",
  /** 著者 = 人物ページ (Sanity 上は `author` 型) */
  "sanity:authors",
  /** 生産者 (farmer) の一覧・詳細 */
  "sanity:farmers",
  /** イベント詳細 (一覧は時刻依存のため名札を使わない。後述) */
  "sanity:events",
  /** お茶メニューの一覧・詳細 */
  "sanity:tea-menus",
  /** プレイリストの一覧・詳細 */
  "sanity:playlists",
  /** elxea Journal の一覧・詳細 */
  "sanity:journals",
  /** 自由ページ (`/pages/[slug]`) */
  "sanity:pages",
  /** サイト設定 (ヘッダー・フッターのナビゲーション) */
  "sanity:site-settings",
  /** sitemap.xml が読む slug 一覧 (全ドキュメント型を横断する) */
  "sanity:sitemap",
] as const;

export type CacheTag = (typeof CACHE_TAGS)[number];

/**
 * 各ドキュメント型の**自分自身の読み取り**が載る名札。
 *
 * 「`journal` を読むページのキャッシュはどの名札で剥がせるか」を 1 対 1 で
 * 与える表。扇形 (`SANITY_TYPE_TO_TAGS`) の検算に使う:
 *
 *   スキーマ上 `journal.playlist -> playlist` という参照があり、かつ
 *   `JOURNAL_BY_SLUG_QUERY` がそれを `playlist->{...}` と展開しているなら、
 *   **playlist の更新は journal のページのキャッシュを捨てなければならない**。
 *   すなわち `SANITY_TYPE_TO_TAGS.playlist` に `OWN_TAG.journal` が要る。
 *
 * この検算を `__tests__/cache-tags-registry.test.ts` が
 * **スキーマ (`sanity/schemas/*.ts`) と GROQ から自動で導出**して行う。
 * 手で書いた表どうしを突き合わせるのではなく、**参照の実体**と突き合わせる
 * ので、Studio 側で参照フィールドを 1 本足した時点で検査が要求を出す。
 */
export const SANITY_TYPE_TO_OWN_TAG = {
  article: "sanity:articles",
  author: "sanity:authors",
  category: "sanity:categories",
  event: "sanity:events",
  farmer: "sanity:farmers",
  journal: "sanity:journals",
  page: "sanity:pages",
  playlist: "sanity:playlists",
  siteSettings: "sanity:site-settings",
  tag: "sanity:tags",
  teaMenu: "sanity:tea-menus",
} as const satisfies Record<SanityDocumentType, CacheTag>;

/**
 * 剥がす側の表 — **どのドキュメント型が変わったら、どの名札を捨てるか**。
 *
 * 各行の根拠 (なぜその名札まで飛ぶのか) を併記する。ここが薄いと
 * 「反映されない」が別の形で戻ってくるので、参照関係は必ず理由付きで残す。
 *
 * ## 一度この表は薄すぎた (QA 指摘 / 2026-08-27)
 *
 * 最初の版は「その型を主役にするページ」しか見ておらず、**参照されて他の型の
 * ページの中に描かれている**ぶんを 8 辺取りこぼしていた。たとえば elxea Journal
 * の記事ページは `playlist->{title, albumImage}` を展開して曲名とジャケットを
 * 出すが、`playlist` の行に `sanity:journals` が無かったので、プレイリストの
 * 改題は Journal のページに反映されなかった。片翼だけの機構を直したつもりで、
 * 別の形の片翼が残っていた。
 *
 * 目視で足すと同じ取りこぼしを繰り返すので、いまはスキーマの参照フィールドから
 * 必要な辺を機械で導出してテストが要求する (`SANITY_TYPE_TO_OWN_TAG` 参照)。
 */
export const SANITY_TYPE_TO_TAGS = {
  /**
   * 記事は最も広く波及する。
   * - `categories` / `tags`: 件数付き一覧が記事本数を数えている
   *   (`CATEGORIES_WITH_COUNTS_QUERY` / `TAGS_WITH_COUNTS_QUERY`)
   * - `authors`: 人物ページがその人の記事一覧を出している
   *   (`ARTICLES_BY_AUTHOR_QUERY`)
   * - `sitemap`: 記事 URL が sitemap に載る
   */
  article: [
    "sanity:articles",
    "sanity:categories",
    "sanity:tags",
    "sanity:authors",
    // お茶メニュー詳細が `relatedArticle->{title, slug}` を展開している
    // (`teaMenu.relatedArticle -> article` / TEA_MENU_BY_SLUG_QUERY)
    "sanity:tea-menus",
    // Journal 記事が `relatedPost->` と `otherReads[]->` を展開している
    // (`journal.relatedPost` / `journal.otherReads` -> article)
    "sanity:journals",
    "sanity:sitemap",
  ],

  /**
   * 著者。参照で他の型のページに描かれる範囲が広い。
   * - `articles`: 記事詳細が `author->{name, slug, image, role, bio}` を展開している
   * - `farmers`: 生産者詳細が `interviewer->{name, role, image}` を展開している
   * - `playlists`: プレイリストが `artist->` / `artists[]->` を展開している
   * - `journals`: Journal 記事が `author->{name, role, image, slug}` を展開している
   * - `sitemap`: 人物 URL (`/people/[slug]`) が sitemap に載る
   */
  author: [
    "sanity:authors",
    "sanity:articles",
    "sanity:farmers",
    "sanity:playlists",
    "sanity:journals",
    "sanity:sitemap",
  ],

  /**
   * カテゴリ。
   * - `articles`: 記事詳細・記事一覧が `category->{title, slug}` を展開している
   * - sitemap にカテゴリ URL は無いので `sitemap` は飛ばさない
   */
  category: ["sanity:categories", "sanity:articles"],

  /** イベント。詳細ページと sitemap。一覧は時刻依存で名札を持たない (後述)。 */
  event: ["sanity:events", "sanity:sitemap"],

  /** 生産者。詳細・一覧と sitemap。 */
  farmer: ["sanity:farmers", "sanity:sitemap"],

  /** elxea Journal。 */
  journal: ["sanity:journals", "sanity:sitemap"],

  /** 自由ページ。sitemap には載らない (静的 URL 表の側で扱っている)。 */
  page: ["sanity:pages"],

  /**
   * プレイリスト。
   * - `journals`: Journal 記事が `playlist->{title, slug, albumImage, spotifyUrl}`
   *   を展開して曲名とジャケットを出している
   */
  playlist: ["sanity:playlists", "sanity:journals", "sanity:sitemap"],

  /** サイト設定。ヘッダー・フッターのナビゲーションだけを持つ。 */
  siteSettings: ["sanity:site-settings"],

  /**
   * タグ。
   * - `articles`: 記事詳細が `tags[]->{title, slug}` を展開している
   * - `playlists`: プレイリスト詳細が `tags[]->` を展開している
   * - `journals`: Journal 記事が `nextReadTags[]->` を回遊ボタンに出している
   * - sitemap にタグ URL は無い
   */
  tag: ["sanity:tags", "sanity:articles", "sanity:playlists", "sanity:journals"],

  /**
   * お茶メニュー。
   * - `journals`: Journal 記事が `teaMenus[]->` を展開している
   */
  teaMenu: ["sanity:tea-menus", "sanity:journals", "sanity:sitemap"],
} as const satisfies Record<SanityDocumentType, readonly [CacheTag, ...CacheTag[]]>;

/** webhook が名乗ってきた `_type` が、この表の知っている型かどうか。 */
export function isSanityDocumentType(value: unknown): value is SanityDocumentType {
  return (
    typeof value === "string" &&
    (SANITY_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * 変更されたドキュメント型に対して捨てるべき名札の一覧。
 * 呼び出し側 (`app/api/revalidate/route.ts`) はここから受け取った値だけを
 * `revalidateTag` に渡す — 文字列リテラルを直に書かない。
 */
export function tagsForSanityType(type: SanityDocumentType): readonly CacheTag[] {
  return SANITY_TYPE_TO_TAGS[type];
}
