import { PortableText as PortableTextReact, type PortableTextComponents } from "@portabletext/react";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import type { PortableTextBlock } from "@portabletext/types";

/**
 * Sanity PortableText の共有シリアライザ。
 *
 * ## 最終ブロックの下マージンを節の外へ漏らさない (C9-1R / 2026-08-09)
 *
 * 各ブロックは下マージンで段間を作る設計 (`normal` = `mb-4` = 16px) なので、
 * **最終ブロックの下マージンが本文枠の外にはみ出す**。節の縦余白を持つ枠
 * (`PageSection` / `Section`) の中に置くと、親が padding を持つため子の下マージンは
 * 相殺されず、**節と節の実測間隔が +16px される**。
 *
 * 実測 (C9-1R / SP 390 / 実データ): お茶メニュー詳細の hero → SPECIFICATION が
 * 期待 64 に対し **80** (= 32 + 32 + 漏れ 16)。PC は hero が `lg:grid` で写真の
 * 高さに揃うため漏れが吸収されて出ず、**SP だけ露見**していた。見本データは説明文が
 * 素の文字列で PortableText を通らないため 64 で、「見本だけで計測すると気づけない」
 * 種類の差分だった。
 *
 * 対処は各ブロックに `last:mb-0` (`:last-child` のとき下マージン 0) を付けること。
 * **ラッパ要素は足さない**。呼び出し側が
 * `[&>*]:mb-0!` / `[&>*+*]:mt-6!` (`ArticleProse`) と
 * **直下子セレクタ**で縦リズムを組んでいるため、`div` を 1 枚挟むと
 * (`display: contents` でも) それらが全滅して段落間 24 が消える。
 *
 * この形なら:
 * - 直下子セレクタは元のまま効く (DOM 構造を変えていない)
 * - `[&>*]:mb-0!` を既に当てている記事詳細 / elxea Journal 詳細は `!important` 側が
 *   勝つので**完全に無影響**
 * - 本文の後ろに別要素を置く枠では最終ブロックが `:last-child` でないので
 *   マージンは残る = 必要な段間は保たれる
 *
 * 先頭ブロックの `margin-top` (`h2` = `mt-12` 等) は**意図的に触っていない**。本文が
 * 見出しで始まるデータが無く、凍結済みの記事詳細の縦リズムを動かす副作用があるため、
 * 必要になったら別途 Figma と突き合わせて判断する。
 */
const components: PortableTextComponents = {
  block: {
    h2: ({ children }) => (
      <h2 className="text-xl font-medium mt-12 mb-4 last:mb-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-medium mt-10 mb-3 last:mb-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-medium mt-8 mb-3 last:mb-0">{children}</h4>
    ),
    normal: ({ children }) => (
      <p className="text-sm text-foreground leading-relaxed mb-4 last:mb-0">{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-foreground pl-6 my-8 last:mb-0 text-sm text-muted-foreground italic">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul className="list-disc pl-6 mb-4 last:mb-0 space-y-1 text-sm">{children}</ul>
    ),
    number: ({ children }) => (
      <ol className="list-decimal pl-6 mb-4 last:mb-0 space-y-1 text-sm">{children}</ol>
    ),
  },
  listItem: {
    bullet: ({ children }) => <li className="text-sm">{children}</li>,
    number: ({ children }) => <li className="text-sm">{children}</li>,
  },
  marks: {
    link: ({ children, value }) => (
      <a
        href={value?.href}
        className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
        target={value?.href?.startsWith("http") ? "_blank" : undefined}
        rel={value?.href?.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    ),
    productEmbed: ({ children, value }) => (
      <span
        className="underline decoration-dotted underline-offset-2"
        data-shopify-handle={value?.shopifyHandle}
      >
        {children}
      </span>
    ),
  },
  types: {
    image: ({ value }) => {
      if (!value?.asset) return null;
      return (
        <figure className="my-8 last:mb-0">
          <Image
            src={urlFor(value).width(1200).url()}
            alt={value.alt || ""}
            width={1200}
            height={800}
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full rounded-md"
          />
          {value.caption && (
            <figcaption className="text-xs text-muted-foreground mt-2">
              {value.caption}
            </figcaption>
          )}
        </figure>
      );
    },
    ctaBlock: ({ value }) => {
      if (!value) return null;
      const href = value.url || (value.shopifyHandle ? `/products/${value.shopifyHandle}` : null);
      const image = value.image;

      return (
        <div className="my-10 last:mb-0 border border-border rounded-lg overflow-hidden">
          {image?.asset && (
            <Image
              src={urlFor(image).width(800).height(400).url()}
              alt={value.title || ""}
              width={800}
              height={400}
              sizes="(max-width: 768px) 100vw, 768px"
              className="w-full object-cover"
            />
          )}
          <div className="p-6">
            {value.title && (
              <p className="text-sm font-medium mb-3">{value.title}</p>
            )}
            {href && (
              <a
                href={href}
                target={value.url?.startsWith("http") ? "_blank" : undefined}
                rel={value.url?.startsWith("http") ? "noopener noreferrer" : undefined}
                className="inline-block text-xs font-medium border border-foreground px-4 py-2 hover:bg-foreground hover:text-background transition-colors"
              >
                {value.title || "詳しく見る"}
              </a>
            )}
          </div>
        </div>
      );
    },
  },
};

export function PortableText({ value }: { value: PortableTextBlock[] }) {
  return <PortableTextReact value={value} components={components} />;
}
