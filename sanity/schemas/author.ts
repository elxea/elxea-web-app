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
      name: "role",
      title: "役割",
      type: "string",
    }),
    defineField({
      name: "bio",
      title: "自己紹介",
      type: "text",
    }),
    defineField({
      name: "website",
      title: "Webサイト",
      type: "url",
    }),

    // --- 以下は People 詳細 凍結テンプレ (Figma 7822:37213 / 7823:37542
    // 「【採用: 作り手の共通テンプレ】 People 詳細」) の構成に対応 (C12-1) ---
    //
    // 同じテンプレの R2 世代の実測値は農家詳細【R2: 確定版】People 詳細テンプレ統合
    // (8079:3748 / 8079:3966) にあり、farmer schema が C4-4a で同名のフィールド群を
    // 既に持っている。People 詳細はそこから茶園 2 節 (fieldBand / fieldSeasons) を
    // 除いた形なので、farmer と**同じフィールド名**を採る (将来テンプレ共通骨格を
    // 1 本に寄せるときに読み替えが不要になる)。
    //
    // すべて任意。節ごとに「この配列 / この文字列が入っているときだけ節を出す」
    // 判定に使い、未入力の節は枠ごと出さない (空枠を出さない方針)。
    defineField({
      name: "kicker",
      title: "英字キッカー (詳細ページ冒頭)",
      type: "string",
      description:
        "例: PEOPLE 04 — ROASTER, HONYAMA。未入力なら共通の既定キッカーを出す。",
    }),
    defineField({
      name: "meta",
      title: "メタ 1 行 (拠点・年数など)",
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
      description: "詳細ページ冒頭のクレジット。写真・肩書は参照先を使う。",
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
      name: "relatedProducts",
      title: "この人が関わったお茶 (Shopify handle)",
      type: "array",
      of: [{ type: "string" }],
      description: "商品ハンドルを最大 3 件。空なら節ごと出さない。",
    }),
    defineField({
      name: "teasHead",
      title: "この人が関わったお茶 の見出し",
      type: "string",
      description: "例: 白井が火を入れたお茶。商品は relatedProducts を使う。",
    }),
  ],
  preview: {
    select: {
      title: "name",
      media: "image",
    },
  },
});
