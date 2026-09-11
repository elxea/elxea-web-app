import { defineField, defineType } from "sanity";

export const teaMenu = defineType({
  name: "teaMenu",
  title: "お茶メニュー",
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
      name: "productNumber",
      title: "商品番号",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "category",
      title: "お茶の種類",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "displayName",
      title: "表示名",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    // 以下 5 つは required を外している。銘柄の正本は Notion Tea Menu List で、
    // 43 件のうち品種・収穫時期が未設定の行があり、写真は Notion 側に無い
    // (内容量も「3g」のような文字列で、数値が取れない行がある)。
    // required のままだと同期した実データが Studio 上で全件エラー表示になり、
    // 「入力漏れ」と「正本にまだ無い」の区別が付かなくなる。
    defineField({
      name: "variety",
      title: "品種名",
      type: "string",
    }),
    defineField({
      name: "season",
      title: "収穫時期",
      type: "string",
    }),
    defineField({
      name: "origin",
      title: "産地（表示用）",
      description:
        "表示用の自由記述。地図・集計には下の prefecture / area / location を使う。",
      type: "string",
    }),
    defineField({
      name: "netWeight",
      title: "内容量（g）",
      type: "number",
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

    // ─── 構造化産地 ───────────────────────────────────────────
    //
    // 産地は銘柄ではなく仕入先に紐づく (Notion Supplier List の
    // Prefecture / Regions / Place)。`origin` は表示用の自由記述なので、
    // 地図のポリゴン結合・県別集計はこちらの構造化フィールドを使う。
    // 値は scripts/sync-notion-to-sanity.ts の --tea-menu が入れる。
    defineField({
      name: "supplier",
      title: "仕入先",
      description: "Notion Supplier List の Name。農家紹介の導線に使う。",
      type: "string",
    }),
    defineField({
      name: "prefecture",
      title: "都道府県",
      description: "47 都道府県の正式名称。地図ポリゴンとの結合キー。",
      type: "string",
    }),
    defineField({
      name: "area",
      title: "市町村・地域",
      type: "string",
    }),
    defineField({
      name: "location",
      title: "産地の座標",
      description:
        "地図に打つ点。座標が確定できない銘柄では未設定のままにする (推測値を入れない)。",
      type: "geopoint",
    }),
    defineField({
      name: "originPrecision",
      title: "座標の粒度",
      description:
        "area = 市町村まで特定 / prefecture = 県の代表点で代用 / none = 座標なし。地図側でピンの見せ方を変える材料。",
      type: "string",
      options: {
        list: [
          { title: "市町村・地域", value: "area" },
          { title: "都道府県のみ", value: "prefecture" },
          { title: "座標なし", value: "none" },
        ],
      },
    }),
    defineField({
      name: "notionId",
      title: "Notion ページ ID",
      description: "同期元の Tea Menu List の行。由来を追うためだけに持つ。",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "description",
      title: "説明",
      type: "text",
    }),
    defineField({
      name: "color",
      title: "テーマカラー",
      type: "string",
    }),
    defineField({
      name: "brewingGuide",
      title: "淹れ方ガイド",
      type: "object",
      // Notion 側は「95℃ 120cc 90sec」の 1 行表記と項目別入力が混在しており、
      // 3 つ揃わない行がある。required を外し、揃った分だけ入れる
      // (揃わない項目を空文字で埋めて「入力済み」に見せない)。
      fields: [
        defineField({
          name: "temperature",
          title: "温度（℃）",
          type: "string",
        }),
        defineField({
          name: "water",
          title: "湯量（ml）",
          type: "string",
        }),
        defineField({
          name: "time",
          title: "抽出時間（秒）",
          type: "string",
        }),
      ],
    }),
    defineField({
      name: "relatedArticle",
      title: "関連記事",
      type: "reference",
      to: [{ type: "article" }],
    }),
    defineField({
      name: "shopifyHandle",
      title: "Shopify商品ハンドル",
      type: "string",
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
      title: "displayName",
      subtitle: "productNumber",
      media: "photo",
    },
  },
});
