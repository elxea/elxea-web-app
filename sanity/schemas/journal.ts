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
      name: "author",
      title: "執筆者",
      description:
        "記事冒頭のクレジット (Figma 確定版 8110:46903)。未設定なら枠ごと出さない。",
      type: "reference",
      to: [{ type: "author" }],
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
        defineField({
          name: "caption",
          title: "キャプション",
          description:
            "写真左下に重ねるクレジット・撮影メモ (例: PHOTO — 朝霧の斜面 5:40)。",
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
      name: "otherReads",
      title: "この号のほかの読みもの",
      description:
        "記事末尾に 3 本まで並べる読みもの (Figma 確定版 8110:46934)。未設定なら relatedPost を 1 行だけ出し、それも無ければ枠ごと出さない。",
      type: "array",
      of: [{ type: "reference", to: [{ type: "article" }] }],
      validation: (rule) => rule.max(3),
    }),
    defineField({
      name: "nextReadTags",
      title: "テーマ回遊タグ",
      description:
        "末尾の回遊ボタンに出すタグ (Figma 確定版 8110:46945)。行き止まりを作らないための導線。2 件まで。",
      type: "array",
      of: [{ type: "reference", to: [{ type: "tag" }] }],
      validation: (rule) => rule.max(2),
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
