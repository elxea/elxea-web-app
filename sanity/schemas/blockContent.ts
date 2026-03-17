import { defineArrayMember, defineType } from "sanity";

export const blockContent = defineType({
  name: "blockContent",
  title: "ブロックコンテンツ",
  type: "array",
  of: [
    defineArrayMember({
      type: "block",
      styles: [
        { title: "通常", value: "normal" },
        { title: "見出し2", value: "h2" },
        { title: "見出し3", value: "h3" },
        { title: "見出し4", value: "h4" },
        { title: "引用", value: "blockquote" },
      ],
      lists: [
        { title: "箇条書き", value: "bullet" },
        { title: "番号付き", value: "number" },
      ],
      marks: {
        decorators: [
          { title: "太字", value: "strong" },
          { title: "斜体", value: "em" },
          { title: "下線", value: "underline" },
        ],
        annotations: [
          {
            name: "link",
            type: "object",
            title: "リンク",
            fields: [
              {
                name: "href",
                type: "url",
                title: "URL",
                validation: (rule) =>
                  rule.uri({ allowRelative: true, scheme: ["http", "https", "mailto"] }),
              },
            ],
          },
          {
            name: "productEmbed",
            type: "object",
            title: "商品埋め込み",
            fields: [
              {
                name: "shopifyHandle",
                type: "string",
                title: "Shopify商品ハンドル",
              },
            ],
          },
        ],
      },
    }),
    defineArrayMember({
      type: "object",
      name: "ctaBlock",
      title: "CTAブロック",
      fields: [
        {
          name: "title",
          type: "string",
          title: "タイトル",
        },
        {
          name: "image",
          type: "image",
          title: "画像",
          options: { hotspot: true },
        },
        {
          name: "url",
          type: "url",
          title: "リンクURL",
        },
        {
          name: "shopifyHandle",
          type: "string",
          title: "Shopify商品ハンドル",
        },
      ],
      preview: {
        select: { title: "title" },
        prepare({ title }) {
          return { title: `CTA: ${title || "未設定"}` };
        },
      },
    }),
    defineArrayMember({
      type: "image",
      options: { hotspot: true },
      fields: [
        {
          name: "alt",
          type: "string",
          title: "代替テキスト",
        },
        {
          name: "caption",
          type: "string",
          title: "キャプション",
        },
      ],
    }),
  ],
});
