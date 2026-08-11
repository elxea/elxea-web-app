import { groq } from "next-sanity";

// Articles
/**
 * 一覧カード 1 枚を描くのに必要なフィールド。
 * 昇順・降順・カテゴリ絞り込みで同じ形を返すため 1 か所に置く
 * (GROQ の `order()` は引数を取れないので、並び順ごとにクエリを分けている)。
 */
const ARTICLE_LIST_FIELDS = groq`
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    requiredTier,
    featured,
    orderNumber,
    contentPersona,
    depthLevel,
    targetLayer,
    category->{title, slug},
    tags[]->{_id, title, slug},
    author->{name, slug, image}
`;

export const ARTICLES_QUERY = groq`
  *[_type == "article" && language == $language] | order(publishedAt desc) [$start...$end] {
    ${ARTICLE_LIST_FIELDS}
  }
`;

/** 古い順。`[...list].reverse()` はページングした窓の中しか反転できないため。 */
export const ARTICLES_ASC_QUERY = groq`
  *[_type == "article" && language == $language] | order(publishedAt asc) [$start...$end] {
    ${ARTICLE_LIST_FIELDS}
  }
`;

export const ARTICLES_BY_CATEGORY_QUERY = groq`
  *[_type == "article" && language == $language && category->slug.current == $categorySlug] | order(publishedAt desc) [$start...$end] {
    ${ARTICLE_LIST_FIELDS}
  }
`;

export const ARTICLES_BY_CATEGORY_ASC_QUERY = groq`
  *[_type == "article" && language == $language && category->slug.current == $categorySlug] | order(publishedAt asc) [$start...$end] {
    ${ARTICLE_LIST_FIELDS}
  }
`;

/**
 * 総件数。「もっと見る」を出すかどうかは取得した窓ではなく総数で決める
 * (窓だけで判断すると、窓の外にある記事に永久に到達できなくなる)。
 */
export const ARTICLES_COUNT_QUERY = groq`
  count(*[_type == "article" && language == $language])
`;

export const ARTICLES_BY_CATEGORY_COUNT_QUERY = groq`
  count(*[_type == "article" && language == $language && category->slug.current == $categorySlug])
`;

/**
 * 記事検索 (D2)。/search が商品しか引かず、記事が増えるほど回遊の穴になっていた。
 *
 * `$term` には呼び出し側で後方ワイルドカード (`お茶*`) を付けて渡す。
 * 見出し・抜粋に加えて本文 (Portable Text) も `pt::text()` で平文化して当てる。
 */
export const ARTICLES_SEARCH_QUERY = groq`
  *[_type == "article" && language == $language && (
    title match $term ||
    excerpt match $term ||
    pt::text(body) match $term
  )] | order(publishedAt desc) [$start...$end] {
    ${ARTICLE_LIST_FIELDS}
  }
`;

export const ARTICLES_SEARCH_COUNT_QUERY = groq`
  count(*[_type == "article" && language == $language && (
    title match $term ||
    excerpt match $term ||
    pt::text(body) match $term
  )])
`;

export const FEATURED_ARTICLES_QUERY = groq`
  *[_type == "article" && language == $language && featured == true] | order(publishedAt desc) [0...4] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    requiredTier,
    category->{title, slug},
    author->{name, slug, image}
  }
`;

export const ARTICLE_BY_SLUG_QUERY = groq`
  *[_type == "article" && slug.current == $slug && language == $language][0] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    body,
    publishedAt,
    memberOnly,
    requiredTier,
    featured,
    orderNumber,
    relatedProducts,
    audioVideoUrl,
    audioUrl,
    cta,
    category->{_id, title, slug},
    tags[]->{_id, title, slug},
    author->{name, slug, image, role, bio, website},
    seo
  }
`;

export const RELATED_ARTICLES_QUERY = groq`
  *[_type == "article" && language == $language && _id != $currentId && (
    category._ref == $categoryId ||
    count((tags[]._ref)[@ in $tagIds]) > 0
  )] | order(publishedAt desc) [0...4] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    requiredTier,
    category->{title, slug}
  }
`;

// Categories
export const CATEGORIES_QUERY = groq`
  *[_type == "category"] | order(title asc) {
    _id,
    title,
    slug
  }
`;

// Farmers
export const FARMERS_QUERY = groq`
  *[_type == "farmer" && language == $language] | order(name asc) {
    _id,
    name,
    slug,
    photo,
    region,
    country
  }
`;

export const FARMER_BY_SLUG_QUERY = groq`
  *[_type == "farmer" && slug.current == $slug && language == $language][0] {
    _id,
    name,
    slug,
    photo,
    region,
    country,
    bio,
    relatedProducts,
    seo
  }
`;

// Events
export const EVENTS_QUERY = groq`
  *[_type == "event" && language == $language && date >= now()] | order(date asc) {
    _id,
    title,
    slug,
    image,
    date,
    endDate,
    location,
    memberOnly,
    requiredTier,
    externalUrl
  }
`;

export const EVENT_BY_SLUG_QUERY = groq`
  *[_type == "event" && slug.current == $slug && language == $language][0] {
    _id,
    title,
    slug,
    description,
    image,
    date,
    endDate,
    location,
    memberOnly,
    requiredTier,
    externalUrl,
    seo
  }
`;

// カテゴリ表示名 (チップ・絞り込みラベルの正本)。
// slug.current が teaMenu.category の値と対応する。
export const CATEGORY_LABELS_QUERY = groq`
  *[_type == "category"] {
    "slug": slug.current,
    title,
    displayName
  }
`;

// Tea Menu
export const TEA_MENUS_QUERY = groq`
  *[_type == "teaMenu" && language == $language] | order(productNumber asc) {
    _id,
    title,
    slug,
    productNumber,
    category,
    displayName,
    variety,
    origin,
    photo,
    color
  }
`;

export const TEA_MENU_BY_SLUG_QUERY = groq`
  *[_type == "teaMenu" && slug.current == $slug && language == $language][0] {
    _id,
    title,
    slug,
    productNumber,
    category,
    displayName,
    variety,
    season,
    origin,
    netWeight,
    photo,
    description,
    color,
    brewingGuide,
    relatedArticle->{title, slug},
    shopifyHandle,
    seo,
    language
  }
`;

// Playlists
export const PLAYLISTS_QUERY = groq`
  *[_type == "playlist"] | order(dateRecorded desc) {
    _id,
    title,
    slug,
    category,
    albumImage,
    description,
    featured,
    artist->{name, slug, image},
    colors
  }
`;

export const PLAYLIST_BY_SLUG_QUERY = groq`
  *[_type == "playlist" && slug.current == $slug][0] {
    _id,
    title,
    slug,
    category,
    tags[]->{_id, title, slug},
    artist->{name, slug, image, role, bio},
    albumImage,
    description,
    body,
    curatorQuote,
    curatorQuoteBy,
    artists[]->{_id, name, slug, image, role, bio},
    tracks[]{title, note, minutes},
    dataBand[]{label, value},
    pairedTeas,
    spotifyUrl,
    soundcloudUrl,
    youtubeUrl,
    dateRecorded,
    featured,
    colors
  }
`;

// ほかの月のプレイリスト (Figma 8089:4605)。表示中の 1 件は除く。
export const OTHER_PLAYLISTS_QUERY = groq`
  *[_type == "playlist" && slug.current != $slug] | order(dateRecorded desc) [0...3] {
    _id,
    title,
    slug,
    category,
    albumImage,
    dateRecorded,
    artist->{name}
  }
`;

// elxea Journal / Set Edition — アソートセット購入者が見るプリセット版 roji 体験。
// 呼称は Setaka 2026-08-11 確定 (「ニュースレター」は廃語)。Sanity の型名
// `journal` と URL `/elxea-journal` は互換のため据え置き。
export const JOURNALS_QUERY = groq`
  *[_type == "journal" && language == $language] | order(title asc) {
    _id,
    title,
    slug,
    theme,
    summary,
    mainImage,
    thumbnail,
    featured
  }
`;

export const JOURNAL_BY_SLUG_QUERY = groq`
  *[_type == "journal" && slug.current == $slug && language == $language][0] {
    _id,
    title,
    slug,
    theme,
    summary,
    body,
    mainImage,
    thumbnail,
    relatedPost->{title, slug},
    playlist->{title, slug, albumImage, spotifyUrl},
    teaMenus[]->{
      _id, title, slug, displayName, productNumber,
      category, variety, season, origin, netWeight, photo
    },
    featured,
    seo,
    language
  }
`;

// Tags
export const TAG_BY_SLUG_QUERY = groq`
  *[_type == "tag" && slug.current == $tagSlug][0] {
    _id,
    title,
    slug
  }
`;

// タグ一覧 + 記事本数 (Figma 8082:4004 TagMap)。記事 0 本のタグは出さない。
export const TAGS_WITH_COUNTS_QUERY = groq`
  *[_type == "tag"] {
    _id,
    title,
    slug,
    "count": count(*[_type == "article" && language == $language && ^._id in tags[]._ref])
  }[count > 0] | order(count desc, title asc)
`;

// カテゴリ一覧 + 記事本数 (Figma 8083:4088 ShelfHead「12本」/ 8083:4083 集計)。
export const CATEGORIES_WITH_COUNTS_QUERY = groq`
  *[_type == "category"] | order(title asc) {
    _id,
    title,
    slug,
    "count": count(*[_type == "article" && language == $language && category._ref == ^._id])
  }
`;

// 商品詳細「読みもの」(Figma 8056 系 PDP)。引き当ては Sanity 記事側の
// relatedProducts (Shopify ハンドルの配列) を唯一の根拠にする。
export const ARTICLES_BY_PRODUCT_QUERY = groq`
  *[_type == "article" && language == $language && $productHandle in relatedProducts]
    | order(publishedAt desc) [0...$limit] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    category->{title, slug},
    author->{name, slug, image}
  }
`;

export const ARTICLES_BY_TAG_QUERY = groq`
  *[_type == "article" && language == $language && $tagSlug in tags[]->slug.current] | order(publishedAt desc) [$start...$end] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    category->{title, slug},
    tags[]->{_id, title, slug},
    author->{name, slug, image}
  }
`;

// People (Author detail)
export const AUTHOR_BY_SLUG_QUERY = groq`
  *[_type == "author" && slug.current == $slug][0] {
    _id,
    name,
    slug,
    image,
    role,
    bio,
    website
  }
`;

export const ARTICLES_BY_AUTHOR_QUERY = groq`
  *[_type == "article" && language == $language && author->slug.current == $authorSlug] | order(publishedAt desc) [$start...$end] {
    _id,
    title,
    slug,
    excerpt,
    thumbnail,
    mainImage,
    publishedAt,
    memberOnly,
    requiredTier,
    category->{title, slug},
    tags[]->{_id, title, slug},
    author->{name, slug, image}
  }
`;

// Pages
export const PAGE_BY_SLUG_QUERY = groq`
  *[_type == "page" && slug.current == $slug && language == $language][0] {
    _id,
    _createdAt,
    _updatedAt,
    title,
    slug,
    body,
    seo
  }
`;

// Site Settings
export const SITE_SETTINGS_QUERY = groq`
  *[_type == "siteSettings"][0] {
    title,
    description,
    ogImage,
    navigation[] {
      label,
      labelEn,
      href,
      order,
      showInHeader,
      showInFooter,
      footerGroup
    },
    footerGroups[] {
      key,
      label,
      labelEn,
      order
    },
    footerText,
    socialLinks
  }
`;

export const PAGE_CONTENT_QUERY = groq`
  *[_type == "page" && slug.current == $slug][0] {
    _id,
    title,
    slug,
    contentFields[] {
      key,
      ja,
      en,
      fieldType
    },
    seo {
      metaTitle,
      metaDescription,
      ogImage
    }
  }
`;
