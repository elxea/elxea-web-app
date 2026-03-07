import { defineField, defineType } from "sanity";

export const author = defineType({
  name: "author",
  title: "執筆者",
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
      name: "image",
      title: "写真",
      type: "image",
      options: { hotspot: true },
    }),
    defineField({
      name: "bio",
      title: "自己紹介",
      type: "text",
    }),
  ],
  preview: {
    select: {
      title: "name",
      media: "image",
    },
  },
});
