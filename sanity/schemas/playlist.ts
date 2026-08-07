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
    // --- 以下は【R2: 確定版】プレイリスト詳細 (Figma 8089:4518) の構成に対応 ---
    defineField({
      name: "curatorQuote",
      title: "選盤者の一言 (反転面の引用)",
      type: "text",
      description: "詳細ページの引用帯に出る 2〜3 行。未入力なら帯ごと出ない。",
    }),
    defineField({
      name: "curatorQuoteBy",
      title: "引用の帰属 (話し手)",
      type: "string",
    }),
    defineField({
      name: "artists",
      title: "収録アーティスト (プロフィールを出す)",
      type: "array",
      of: [{ type: "reference", to: [{ type: "author" }] }],
      description: "詳細ページ ARTISTS 節。写真・肩書き・紹介文は author 側を使う。",
    }),
    defineField({
      name: "tracks",
      title: "収録曲",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "title",
              title: "曲名",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({ name: "note", title: "メモ", type: "text" }),
            defineField({ name: "minutes", title: "長さ (分)", type: "number" }),
          ],
          preview: { select: { title: "title", subtitle: "note" } },
        },
      ],
      description: "曲数と合計分数は、この配列から自動で数える。",
    }),
    defineField({
      name: "dataBand",
      title: "データ帯 (最大 4 項目)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "label",
              title: "項目名",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "value",
              title: "値",
              type: "string",
              validation: (rule) => rule.required(),
            }),
          ],
          preview: { select: { title: "label", subtitle: "value" } },
        },
      ],
      validation: (rule) => rule.max(4),
      description: "詳細ページ PLAYLIST DATA 節の 4 カラム。項目名は編集側で決める。",
    }),
    defineField({
      name: "pairedTeas",
      title: "合わせるお茶 (Shopify ハンドル)",
      type: "array",
      of: [{ type: "string" }],
      description:
        "商品ハンドルを並べる。記事の relatedProducts と同じ方式で、購入導線は最下部に出る。",
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
