import { defineField, defineType } from "sanity";

export const category = defineType({
  name: "category",
  title: "カテゴリー",
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
      name: "displayName",
      title: "表示名（日本語）",
      description:
        "画面のチップ・絞り込みに出す日本語表示名。slug が teaMenu.category の値と一致するカテゴリの表示名が使われる。未入力なら teaMenu.category の生値がそのまま出る。",
      type: "string",
    }),
    defineField({
      name: "description",
      title: "説明",
      type: "text",
    }),
  ],
});
