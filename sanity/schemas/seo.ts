import { defineField, defineType } from "sanity";

export const seo = defineType({
  name: "seo",
  title: "SEO",
  type: "object",
  fields: [
    defineField({
      name: "metaTitle",
      title: "メタタイトル",
      type: "string",
    }),
    defineField({
      name: "metaDescription",
      title: "メタディスクリプション",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "ogImage",
      title: "OGP画像",
      type: "image",
    }),
  ],
});
