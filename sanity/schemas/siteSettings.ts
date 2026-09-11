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
              name: "labelEn",
              title: "ラベル（英語）",
              type: "string",
            }),
            defineField({
              name: "href",
              title: "リンク先",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "order",
              title: "順序",
              type: "number",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "showInHeader",
              title: "ヘッダーに表示",
              type: "boolean",
              initialValue: false,
            }),
            defineField({
              name: "showInFooter",
              title: "フッターに表示",
              type: "boolean",
              initialValue: false,
            }),
            defineField({
              name: "footerGroup",
              title: "フッターグループ",
              type: "string",
              options: {
                list: [
                  { title: "Shop", value: "Shop" },
                  { title: "Content", value: "Content" },
                  { title: "Support", value: "Support" },
                  { title: "Legal", value: "Legal" },
                ],
              },
            }),
          ],
          preview: {
            select: { title: "label", subtitle: "href" },
          },
        },
      ],
    }),
    defineField({
      name: "footerGroups",
      title: "フッターグループ",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "key",
              title: "キー",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "label",
              title: "ラベル",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "labelEn",
              title: "ラベル（英語）",
              type: "string",
            }),
            defineField({
              name: "order",
              title: "順序",
              type: "number",
            }),
          ],
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
