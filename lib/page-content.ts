export type ContentField = {
  key: string;
  ja: string;
  en: string;
  fieldType: "text" | "image" | "url";
};

export function getField(
  fields: ContentField[] | null | undefined,
  key: string,
  locale: string
): string {
  if (!fields) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[page-content] contentFields is null/undefined when looking for key: "${key}"`);
    }
    return "";
  }
  const field = fields.find((f) => f.key === key);
  if (!field) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[page-content] Key not found: "${key}"`);
    }
    return "";
  }
  return locale === "en" && field.en ? field.en : field.ja;
}
