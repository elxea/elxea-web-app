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
    contextTime,
    contextSeason,
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
    contextTime,
    contextSeason,
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
    spotifyUrl,
    soundcloudUrl,
    youtubeUrl,
    dateRecorded,
    featured,
    colors
  }
`;

// elxea Journal (newsletter)
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
    teaMenus[]->{_id, title, slug, displayName, photo},
    featured,
    seo,
    language
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
  *[_type == "article" && language == $language && author->slug.current == $authorSlug] | order(publishedAt desc) [0...10] {
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

// Pages
export const PAGE_BY_SLUG_QUERY = groq`
  *[_type == "page" && slug.current == $slug && language == $language][0] {
    _id,
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
    navigation,
    footerText,
    socialLinks
  }
`;
