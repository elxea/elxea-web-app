import { PortableText as PortableTextReact, type PortableTextComponents } from "@portabletext/react";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import type { PortableTextBlock } from "@portabletext/types";

const components: PortableTextComponents = {
  block: {
    h2: ({ children }) => (
      <h2 className="text-xl font-medium mt-12 mb-4">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-medium mt-10 mb-3">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-medium mt-8 mb-3">{children}</h4>
    ),
    normal: ({ children }) => (
      <p className="text-sm text-foreground leading-relaxed mb-4">{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-foreground pl-6 my-8 text-sm text-muted-foreground italic">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul className="list-disc pl-6 mb-4 space-y-1 text-sm">{children}</ul>
    ),
    number: ({ children }) => (
      <ol className="list-decimal pl-6 mb-4 space-y-1 text-sm">{children}</ol>
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
        <figure className="my-8">
          <Image
            src={urlFor(value).width(1200).url()}
            alt={value.alt || ""}
            width={1200}
            height={800}
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full"
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
        <div className="my-10 border border-border rounded-lg overflow-hidden">
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
