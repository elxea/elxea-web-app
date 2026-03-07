import { defineField, defineType } from "sanity";

export const event = defineType({
  name: "event",
  title: "イベント",
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
      name: "description",
      title: "説明",
      type: "blockContent",
    }),
    defineField({
      name: "image",
      title: "画像",
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
      name: "date",
      title: "開催日",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "endDate",
      title: "終了日",
      type: "datetime",
    }),
    defineField({
      name: "location",
      title: "場所",
      type: "string",
    }),
    defineField({
      name: "memberOnly",
      title: "会員限定",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "externalUrl",
      title: "外部リンク",
      type: "url",
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
      subtitle: "date",
      media: "image",
    },
  },
  orderings: [
    {
      title: "開催日（新しい順）",
      name: "dateDesc",
      by: [{ field: "date", direction: "desc" }],
    },
  ],
});
