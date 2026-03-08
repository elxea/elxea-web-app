"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Image as ImageType } from "@/lib/shopify/types";

export function ImageGallery({ images }: { images: ImageType[] }) {
  const [selected, setSelected] = useState(0);
  const t = useTranslations("common");

  if (images.length === 0) {
    return (
      <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground rounded-md">
        {t("noImage")}
      </div>
    );
  }

  return (
    <div>
      {/* Main image */}
      <div className="aspect-square bg-muted mb-3 overflow-hidden rounded-md">
        <Image
          src={images[selected].url}
          alt={images[selected].altText || ""}
          width={800}
          height={800}
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="w-full h-full object-cover"
          priority
        />
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto" role="listbox" aria-label="Product images">
          {images.map((image, i) => (
            <Button
              key={i}
              variant="ghost"
              className={`w-16 h-16 p-0 flex-shrink-0 overflow-hidden rounded-md border ${
                i === selected ? "border-foreground" : "border-transparent"
              }`}
              onClick={() => setSelected(i)}
              aria-selected={i === selected}
              aria-label={`Image ${i + 1} of ${images.length}`}
              role="option"
            >
              <Image
                src={image.url}
                alt={image.altText || ""}
                width={64}
                height={64}
                sizes="64px"
                className="w-full h-full object-cover"
              />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
