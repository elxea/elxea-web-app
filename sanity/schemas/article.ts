import { defineField, defineType } from "sanity";

export const article = defineType({
  name: "article",
  title: "記事 (Journal)",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "タイトル",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "スラッグ",
      type: "slug",
      options: { source: "title", maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "orderNumber",
      title: "記事番号",
      type: "number",
    }),
    defineField({
      name: "excerpt",
      title: "抜粋",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "thumbnail",
      title: "サムネイル",
      type: "image",
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "代替テキスト",
          type: "string",
        }),
      ],
    }),
    defineField({
      name: "mainImage",
      title: "メイン画像",
      type: "image",
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "代替テキスト",
          type: "string",
        }),
      ],
    }),
    defineField({
      name: "body",
      title: "本文",
      type: "blockContent",
    }),
    defineField({
      name: "category",
      title: "カテゴリー",
      type: "reference",
      to: [{ type: "category" }],
    }),
    defineField({
      name: "tags",
      title: "タグ",
      type: "array",
      of: [{ type: "reference", to: [{ type: "tag" }] }],
    }),
    defineField({
      name: "featured",
      title: "注目記事",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "author",
      title: "執筆者",
      type: "reference",
      to: [{ type: "author" }],
    }),
    defineField({
      name: "relatedProducts",
      title: "関連商品（Shopify ハンドル）",
      type: "array",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "audioVideoUrl",
      title: "動画/音声リンク",
      type: "url",
    }),
    defineField({
      name: "audioUrl",
      title: "オーディオURL",
      type: "url",
    }),
    defineField({
      name: "cta",
      title: "CTA",
      type: "object",
      fields: [
        defineField({ name: "title", title: "CTAタイトル", type: "string" }),
        defineField({
          name: "image",
          title: "CTA画像",
          type: "image",
          options: { hotspot: true },
        }),
        defineField({ name: "url", title: "CTAリンク", type: "url" }),
      ],
    }),
    defineField({
      name: "memberOnly",
      title: "会員限定（レガシー）",
      type: "boolean",
      initialValue: false,
      hidden: true,
    }),
    defineField({
      name: "requiredTier",
      title: "閲覧に必要な会員ティア",
      type: "string",
      options: {
        list: [
          { title: "全員公開", value: "none" },
          { title: "スタンダード会員以上", value: "standard" },
          { title: "プレミアム会員のみ", value: "premium" },
        ],
        layout: "radio",
      },
      initialValue: "none",
    }),
    defineField({
      name: "publishedAt",
      title: "公開日",
      type: "datetime",
    }),
    defineField({
      name: "seo",
      title: "SEO",
      type: "seo",
    }),
    defineField({
      name: "language",
      title: "言語",
      type: "string",
      options: {
        list: [
          { title: "日本語", value: "ja" },
          { title: "English", value: "en" },
        ],
      },
      initialValue: "ja",
    }),

    // ── Persona / personalization fields (MS1-3) ─────────────────────────────
    // All fields are optional to preserve backward compatibility with existing articles.
    // They will be required in a future migration once the editorial workflow is ready.

    defineField({
      name: "contentPersona",
      title: "コンテンツペルソナ",
      description:
        "このコンテンツが最も響くペルソナタイプを選んでください（最大2つ）。",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "静寂派 (Serenity)", value: "serenity" },
          { title: "知的好奇心派 (Explorer)", value: "explorer" },
          { title: "感覚派 (Sensory)", value: "sensory" },
        ],
      },
      validation: (rule) => rule.max(2),
    }),

    defineField({
      name: "depthLevel",
      title: "深度レベル",
      description: "記事の内容の深さを示します。",
      type: "string",
      options: {
        list: [
          { title: "入口 — お茶を知り始めた人向け (entry)", value: "entry" },
          { title: "探索 — 飲み比べ・品種に興味がある人向け (explore)", value: "explore" },
          { title: "没入 — 製法・産地を深く掘る人向け (deep)", value: "deep" },
        ],
        layout: "radio",
      },
    }),

    defineField({
      name: "targetLayer",
      title: "ターゲット層",
      description:
        "レコメンドの参考情報です。主軸は contentPersona を使用します（複数選択可）。",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "お茶好き層 (tea_lover)", value: "tea_lover" },
          { title: "ウェルビーイング層 (wellbeing)", value: "wellbeing" },
          { title: "グルメ層 (gourmet)", value: "gourmet" },
        ],
      },
    }),

    defineField({
      name: "contextTime",
      title: "コンテキスト：時間帯",
      description: "この記事が特に合う時間帯（任意）。",
      type: "string",
      options: {
        list: [
          { title: "朝 (morning)", value: "morning" },
          { title: "午後 (afternoon)", value: "afternoon" },
          { title: "夜 (evening)", value: "evening" },
        ],
      },
    }),

    defineField({
      name: "contextSeason",
      title: "コンテキスト：季節",
      description: "この記事が特に合う季節（任意）。",
      type: "string",
      options: {
        list: [
          { title: "春 (spring)", value: "spring" },
          { title: "夏 (summer)", value: "summer" },
          { title: "秋 (autumn)", value: "autumn" },
          { title: "冬 (winter)", value: "winter" },
        ],
      },
    }),
  ],
  preview: {
    select: {
      title: "title",
      media: "mainImage",
      memberOnly: "memberOnly",
      requiredTier: "requiredTier",
    },
    prepare({ title, media, memberOnly, requiredTier }) {
      return {
        title: `${memberOnly || requiredTier !== "none" ? "🔒 " : ""}${title}`,
        media,
      };
    },
  },
  orderings: [
    {
      title: "公開日（新しい順）",
      name: "publishedAtDesc",
      by: [{ field: "publishedAt", direction: "desc" }],
    },
  ],
});
