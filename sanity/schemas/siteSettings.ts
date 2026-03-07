import { defineField, defineType } from "sanity";

export const siteSettings = defineType({
  name: "siteSettings",
  title: "サイト設定",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "サイト名",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      title: "サイト説明",
      type: "text",
    }),
    defineField({
      name: "ogImage",
      title: "OGP画像",
      type: "image",
    }),
    defineField({
      name: "navigation",
      title: "ナビゲーション",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "label",
              title: "ラベル",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "href",
              title: "リンク先",
              type: "string",
              validation: (rule) => rule.required(),
            }),
          ],
          preview: {
            select: { title: "label", subtitle: "href" },
          },
        },
      ],
    }),
    defineField({
      name: "footerText",
      title: "フッターテキスト",
      type: "text",
    }),
    defineField({
      name: "socialLinks",
      title: "SNSリンク",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "platform",
              title: "プラットフォーム",
              type: "string",
              options: {
                list: [
                  { title: "Instagram", value: "instagram" },
                  { title: "X (Twitter)", value: "twitter" },
                  { title: "Facebook", value: "facebook" },
                  { title: "LINE", value: "line" },
                ],
              },
            }),
            defineField({
              name: "url",
              title: "URL",
              type: "url",
            }),
          ],
          preview: {
            select: { title: "platform", subtitle: "url" },
          },
        },
      ],
    }),
  ],
});
