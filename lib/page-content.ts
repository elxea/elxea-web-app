import { isDevelopment } from "@/lib/config";

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
    if (isDevelopment()) {
      console.warn(`[page-content] contentFields is null/undefined when looking for key: "${key}"`);
    }
    return "";
  }
  const field = fields.find((f) => f.key === key);
  if (!field) {
    if (isDevelopment()) {
      console.warn(`[page-content] Key not found: "${key}"`);
    }
    return "";
  }
  return locale === "en" && field.en ? field.en : field.ja;
}
