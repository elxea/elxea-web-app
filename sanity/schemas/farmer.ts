import { defineField, defineType } from "sanity";

export const farmer = defineType({
  name: "farmer",
  title: "農家プロフィール",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "名前",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "スラッグ",
      type: "slug",
      options: { source: "name", maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "photo",
      title: "写真",
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
      name: "region",
      title: "産地",
      type: "string",
    }),
    defineField({
      name: "country",
      title: "国",
      type: "string",
    }),
    defineField({
      name: "bio",
      title: "紹介文",
      type: "blockContent",
    }),
    defineField({
      name: "relatedProducts",
      title: "関連商品（Shopify ハンドル）",
      type: "array",
      of: [{ type: "string" }],
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
      title: "name",
      subtitle: "region",
      media: "photo",
    },
  },
});
