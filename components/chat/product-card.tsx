"use client";

import Image from "next/image";
import type { ProductCardItem } from "./elxea-chat-transport";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: ProductCardItem;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex gap-3 rounded-xl border border-border/40 bg-background p-3",
        "hover:border-primary/30 hover:shadow-sm transition-all",
        "text-left no-underline",
      )}
    >
      {product.image && (
        <div className="shrink-0 size-16 rounded-lg overflow-hidden bg-muted relative">
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-foreground leading-tight truncate">
          {product.name}
        </span>
        <span className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {product.description}
        </span>
        <span className="text-xs font-medium text-primary mt-0.5">
          {product.price}
        </span>
      </div>
    </a>
  );
}

interface ProductCardsProps {
  products: ProductCardItem[];
}

export function ProductCards({ products }: ProductCardsProps) {
  if (products.length === 0) return null;

  return (
    <div
      data-slot="product-cards"
      className="flex flex-col gap-2 w-full max-w-[80%]"
    >
      {products.map((product, i) => (
        <ProductCard key={`${product.url}-${i}`} product={product} />
      ))}
    </div>
  );
}
