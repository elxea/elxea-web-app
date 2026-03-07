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
      name: "excerpt",
      title: "抜粋",
      type: "text",
      rows: 3,
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
      name: "memberOnly",
      title: "会員限定",
      type: "boolean",
      initialValue: false,
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
  ],
  preview: {
    select: {
      title: "title",
      media: "mainImage",
      memberOnly: "memberOnly",
    },
    prepare({ title, media, memberOnly }) {
      return {
        title: `${memberOnly ? "🔒 " : ""}${title}`,
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
