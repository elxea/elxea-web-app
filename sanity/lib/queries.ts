import { groq } from "next-sanity";

// Articles
export const ARTICLES_QUERY = groq`
  *[_type == "article" && language == $language] | order(publishedAt desc) [$start...$end] {
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
  }
`;

export const ARTICLES_BY_CATEGORY_QUERY = groq`
  *[_type == "article" && language == $language && category->slug.current == $categorySlug] | order(publishedAt desc) [$start...$end] {
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
  }
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
    kicker,
    role,
    meta,
    stats[]{value, label},
    interviewer->{name, role, image},
    quote,
    quoteBy,
    workHead,
    work[]{name, description, photo},
    interview[]{question, answer},
    profileBand[]{label, value},
    fieldBand[]{label, value},
    fieldHead,
    fieldSeasons[]{name, description, photo},
    teasHead,
    seo
  }
`;

/**
 * 農家詳細の最下部「ほかの人をたずねる」(Figma 8079:3835 / 8079:4053)。
 * 表示中の本人を除いた 3 件。肩書行は role を使う。
 */
export const OTHER_FARMERS_QUERY = groq`
  *[_type == "farmer" && language == $language && slug.current != $slug] | order(name asc) [0...3] {
    _id,
    name,
    slug,
    photo,
    role,
    region,
    country
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

/**
 * トップ【R2: 確定版】の「つくり手が見える (VOICES)」節 (Figma 8110:2542)。
 * 一言 (quote) が入っている農家だけを 3 件。未入力の農家は節に出さないので、
 * 該当 0 件なら節ごと出ない (空枠を出さない方針)。
 */
export const TOP_FARMER_VOICES_QUERY = groq`
  *[_type == "farmer" && language == $language && defined(quote)] | order(name asc) [0...3] {
    _id,
    name,
    slug,
    region,
    quote
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

// elxea Journal (newsletter)
export const JOURNALS_QUERY = groq`
  *[_type == "journal" && language == $language] | order(title asc) {
    _id,
    _createdAt,
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
    author->{name, role, image, slug},
    relatedPost->{_id, title, slug, thumbnail, mainImage},
    otherReads[]->{_id, title, slug, thumbnail, mainImage},
    nextReadTags[]->{_id, title, slug},
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
