import { article } from "./article";
import { author } from "./author";
import { blockContent } from "./blockContent";
import { category } from "./category";
import { event } from "./event";
import { farmer } from "./farmer";
import { page } from "./page";
import { seo } from "./seo";
import { siteSettings } from "./siteSettings";

export const schemaTypes = [
  // Document types
  article,
  author,
  category,
  event,
  farmer,
  page,
  siteSettings,

  // Object types
  blockContent,
  seo,
];
