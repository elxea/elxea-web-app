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
    // --- 以下は【R2: 確定版】農家詳細 (Figma 8079:3748 / 8079:3966) の構成に対応 ---
    // 節ごとに「この配列 / この文字列が入っているときだけ節を出す」判定に使う。
    // 未入力の節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 と同じ)。
    defineField({
      name: "kicker",
      title: "英字キッカー (詳細ページ冒頭)",
      type: "string",
      description:
        "例: PEOPLE 04 — ROASTER, HONYAMA。未入力なら共通の既定キッカーを出す。",
    }),
    defineField({
      name: "role",
      title: "肩書 (見出し直下の 1 行)",
      type: "string",
      description: "例: 焙煎士 ／ roji の火入れを担う",
    }),
    defineField({
      name: "meta",
      title: "メタ 1 行 (産地・年数など)",
      type: "string",
      description: "例: 静岡県 本山｜2007年から、roji に届くすべての茶葉に火を入れている。",
    }),
    defineField({
      name: "stats",
      title: "実数表示 (最大 2 項目)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "value",
              title: "数値",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "label",
              title: "ラベル (英字)",
              type: "string",
              validation: (rule) => rule.required(),
            }),
          ],
          preview: { select: { title: "value", subtitle: "label" } },
        },
      ],
      validation: (rule) => rule.max(2),
      description: "例: 18 / YEARS, 6 / STORIES。空なら罫線ごと出さない。",
    }),
    defineField({
      name: "interviewer",
      title: "聞き手",
      type: "reference",
      to: [{ type: "author" }],
      description: "詳細ページ冒頭のクレジット。写真・肩書は author 側を使う。",
    }),
    defineField({
      name: "quote",
      title: "本人の一言 (反転面の引用)",
      type: "text",
      description: "詳細ページの引用帯に出る 2〜3 行。未入力なら帯ごと出ない。",
    }),
    defineField({
      name: "quoteBy",
      title: "引用の帰属 (話し手)",
      type: "string",
    }),
    defineField({
      name: "workHead",
      title: "THE WORK の見出し",
      type: "string",
      description: "例: 火入れは、三度に分けて決まる",
    }),
    defineField({
      name: "work",
      title: "THE WORK (手仕事の工程)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "name",
              title: "工程名",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({ name: "description", title: "説明", type: "text" }),
            defineField({
              name: "photo",
              title: "写真",
              type: "image",
              options: { hotspot: true },
              fields: [
                defineField({ name: "alt", title: "代替テキスト", type: "string" }),
              ],
            }),
          ],
          preview: { select: { title: "name", subtitle: "description", media: "photo" } },
        },
      ],
      description: "3 工程を並べる想定。番号は並び順から自動で振る。",
    }),
    defineField({
      name: "interview",
      title: "INTERVIEW (一問一答)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "question",
              title: "問い",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "answer",
              title: "答え",
              type: "text",
              validation: (rule) => rule.required(),
            }),
          ],
          preview: { select: { title: "question", subtitle: "answer" } },
        },
      ],
      description: "Q 番号は並び順から自動で振る。",
    }),
    defineField({
      name: "profileBand",
      title: "PROFILE 帯 (最大 4 項目)",
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
      description: "例: 拠点 / 担当 / はじまり / 手の届く量。項目名は編集側で決める。",
    }),
    defineField({
      name: "fieldBand",
      title: "THE FIELD 帯 (茶園データ・最大 4 項目)",
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
      description: "例: 産地 / 標高 / 品種 / 栽培。茶園を持たない人は空にする。",
    }),
    defineField({
      name: "fieldHead",
      title: "THE FIELD (茶園の一年) の見出し",
      type: "string",
      description: "例: 畑の一年は、三つの季節で決まる",
    }),
    defineField({
      name: "fieldSeasons",
      title: "THE FIELD (茶園の一年)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            defineField({
              name: "name",
              title: "季節名",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({ name: "description", title: "説明", type: "text" }),
            defineField({
              name: "photo",
              title: "写真",
              type: "image",
              options: { hotspot: true },
              fields: [
                defineField({ name: "alt", title: "代替テキスト", type: "string" }),
              ],
            }),
          ],
          preview: { select: { title: "name", subtitle: "description", media: "photo" } },
        },
      ],
      description: "例: 芽をまつ / 摘む / 休ませる。番号は並び順から自動で振る。",
    }),
    defineField({
      name: "teasHead",
      title: "このひとが育てたお茶 の見出し",
      type: "string",
      description: "例: 白井が火を入れたお茶。商品は relatedProducts を使う。",
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
