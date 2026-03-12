import { defineField, defineType } from "sanity";

export const teaMenu = defineType({
  name: "teaMenu",
  title: "お茶メニュー",
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
      name: "productNumber",
      title: "商品番号",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "category",
      title: "お茶の種類",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "displayName",
      title: "表示名",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "variety",
      title: "品種名",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "season",
      title: "収穫時期",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "origin",
      title: "産地",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "netWeight",
      title: "内容量（g）",
      type: "number",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "photo",
      title: "写真",
      type: "image",
      options: { hotspot: true },
      validation: (rule) => rule.required(),
      fields: [
        defineField({
          name: "alt",
          title: "代替テキスト",
          type: "string",
        }),
      ],
    }),
    defineField({
      name: "description",
      title: "説明",
      type: "text",
    }),
    defineField({
      name: "color",
      title: "テーマカラー",
      type: "string",
    }),
    defineField({
      name: "brewingGuide",
      title: "淹れ方ガイド",
      type: "object",
      fields: [
        defineField({
          name: "temperature",
          title: "温度（℃）",
          type: "string",
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: "water",
          title: "湯量（ml）",
          type: "string",
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: "time",
          title: "抽出時間（秒）",
          type: "string",
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineField({
      name: "relatedArticle",
      title: "関連記事",
      type: "reference",
      to: [{ type: "article" }],
    }),
    defineField({
      name: "shopifyHandle",
      title: "Shopify商品ハンドル",
      type: "string",
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
      title: "displayName",
      subtitle: "productNumber",
      media: "photo",
    },
  },
});
