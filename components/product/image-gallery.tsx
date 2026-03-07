"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { Image as ImageType } from "@/lib/shopify/types";

export function ImageGallery({ images }: { images: ImageType[] }) {
  const [selected, setSelected] = useState(0);
  const t = useTranslations("common");

  if (images.length === 0) {
    return (
      <div className="aspect-square bg-surface flex items-center justify-center text-light">
        {t("noImage")}
      </div>
    );
  }

  return (
    <div>
      {/* Main image */}
      <div className="aspect-square bg-surface mb-3 overflow-hidden">
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
            <button
              key={i}
              onClick={() => setSelected(i)}
              aria-selected={i === selected}
              aria-label={`Image ${i + 1} of ${images.length}`}
              role="option"
              className={`w-16 h-16 flex-shrink-0 overflow-hidden border transition-colors ${
                i === selected ? "border-charcoal" : "border-transparent"
              }`}
            >
              <Image
                src={image.url}
                alt={image.altText || ""}
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
