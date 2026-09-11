import { article } from "./article";
import { author } from "./author";
import { blockContent } from "./blockContent";
import { category } from "./category";
import { event } from "./event";
import { farmer } from "./farmer";
import { journal } from "./journal";
import { page } from "./page";
import { playlist } from "./playlist";
import { seo } from "./seo";
import { siteSettings } from "./siteSettings";
import { tag } from "./tag";
import { teaMenu } from "./teaMenu";

export const schemaTypes = [
  // Document types
  article,
  author,
  category,
  event,
  farmer,
  journal,
  page,
  playlist,
  siteSettings,
  tag,
  teaMenu,

  // Object types
  blockContent,
  seo,
];
