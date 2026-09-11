import { defineField, defineType } from "sanity";

export const page = defineType({
  name: "page",
  title: "ページ",
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
      name: "body",
      title: "本文",
      type: "blockContent",
    }),
    defineField({
      name: "seo",
      title: "SEO",
      type: "seo",
    }),
    defineField({
      name: "contentFields",
      title: "コンテンツフィールド",
      type: "array",
      readOnly: true,
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "key",
              title: "キー",
              type: "string",
            }),
            defineField({
              name: "ja",
              title: "日本語",
              type: "text",
            }),
            defineField({
              name: "en",
              title: "英語",
              type: "text",
            }),
            defineField({
              name: "fieldType",
              title: "フィールドタイプ",
              type: "string",
              options: {
                list: [
                  { title: "text", value: "text" },
                  { title: "image", value: "image" },
                  { title: "url", value: "url" },
                ],
              },
            }),
          ],
          preview: {
            select: { title: "key", subtitle: "ja" },
          },
        },
      ],
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
      subtitle: "language",
    },
  },
});
