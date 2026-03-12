import { defineField, defineType } from "sanity";

export const journal = defineType({
  name: "journal",
  title: "elxea Journal",
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
      name: "theme",
      title: "テーマ",
      type: "string",
      options: {
        list: [
          { title: "akane", value: "akane" },
          { title: "sui", value: "sui" },
          { title: "sohi", value: "sohi" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "summary",
      title: "概要",
      type: "text",
    }),
    defineField({
      name: "body",
      title: "本文",
      type: "blockContent",
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
      name: "relatedPost",
      title: "関連記事",
      type: "reference",
      to: [{ type: "article" }],
    }),
    defineField({
      name: "playlist",
      title: "プレイリスト",
      type: "reference",
      to: [{ type: "playlist" }],
    }),
    defineField({
      name: "teaMenus",
      title: "関連お茶メニュー",
      type: "array",
      of: [{ type: "reference", to: [{ type: "teaMenu" }] }],
    }),
    defineField({
      name: "featured",
      title: "注目",
      type: "boolean",
      initialValue: false,
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
    defineField({
      name: "seo",
      title: "SEO",
      type: "seo",
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "theme",
      media: "mainImage",
    },
  },
  orderings: [
    {
      title: "タイトル順",
      name: "titleAsc",
      by: [{ field: "title", direction: "asc" }],
    },
  ],
});
