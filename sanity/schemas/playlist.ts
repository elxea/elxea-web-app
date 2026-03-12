import { defineField, defineType } from "sanity";

export const playlist = defineType({
  name: "playlist",
  title: "プレイリスト (Sound from Nature)",
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
      name: "category",
      title: "カテゴリ",
      type: "string",
    }),
    defineField({
      name: "tags",
      title: "タグ",
      type: "array",
      of: [{ type: "reference", to: [{ type: "tag" }] }],
    }),
    defineField({
      name: "artist",
      title: "アーティスト",
      type: "reference",
      to: [{ type: "author" }],
    }),
    defineField({
      name: "albumImage",
      title: "アルバム画像",
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
      name: "description",
      title: "説明",
      type: "text",
    }),
    defineField({
      name: "body",
      title: "本文",
      type: "blockContent",
    }),
    defineField({
      name: "spotifyUrl",
      title: "Spotify URL",
      type: "url",
    }),
    defineField({
      name: "soundcloudUrl",
      title: "SoundCloud URL",
      type: "url",
    }),
    defineField({
      name: "youtubeUrl",
      title: "YouTube URL",
      type: "url",
    }),
    defineField({
      name: "dateRecorded",
      title: "録音日",
      type: "datetime",
    }),
    defineField({
      name: "featured",
      title: "注目",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "colors",
      title: "カラーパレット",
      type: "object",
      fields: [
        defineField({ name: "color1", title: "カラー1", type: "string" }),
        defineField({ name: "color2", title: "カラー2", type: "string" }),
        defineField({ name: "color3", title: "カラー3", type: "string" }),
        defineField({ name: "color4", title: "カラー4", type: "string" }),
      ],
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "category",
      media: "albumImage",
    },
  },
});
