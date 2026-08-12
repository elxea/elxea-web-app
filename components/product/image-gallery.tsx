"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ImageCard } from "@/components/media/image-card";
import type { Image as ImageType } from "@/lib/shopify/types";

export function ImageGallery({ images }: { images: ImageType[] }) {
  const [selected, setSelected] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const t = useTranslations("common");

  if (images.length === 0) {
    return <ImageCard />;
  }

  return (
    <div>
      {/* Main image — click to zoom */}
      <button
        type="button"
        className="aspect-square bg-muted mb-4 overflow-hidden w-full cursor-zoom-in"
        onClick={() => setZoomOpen(true)}
      >
        <Image
          src={images[selected].url}
          alt={images[selected].altText || ""}
          width={800}
          height={800}
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="w-full h-full object-cover"
          priority
        />
      </button>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto" role="listbox" aria-label="Product images">
          {images.map((image, i) => (
            <Button
              key={i}
              variant="ghost"
              className={`w-20 h-20 p-0 flex-shrink-0 overflow-hidden border transition-all duration-200 ${
                i === selected ? "border-foreground" : "border-transparent hover:border-muted-foreground/30"
              }`}
              onClick={() => setSelected(i)}
              aria-selected={i === selected}
              aria-label={`Image ${i + 1} of ${images.length}`}
              role="option"
            >
              <Image
                src={image.url}
                alt={image.altText || ""}
                width={80}
                height={80}
                sizes="80px"
                className="w-full h-full object-cover"
              />
            </Button>
          ))}
        </div>
      )}

      {/* Zoom dialog */}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 border-none bg-transparent shadow-none">
          <DialogTitle className="sr-only">
            {images[selected].altText || "Product image"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Image {selected + 1} of {images.length}
          </DialogDescription>
          <div className="relative flex items-center justify-center">
            <Image
              src={images[selected].url}
              alt={images[selected].altText || ""}
              width={1200}
              height={1200}
              sizes="90vw"
              className="max-h-[85vh] w-auto object-contain"
            />
            {images.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                  onClick={() => setSelected((selected - 1 + images.length) % images.length)}
                  aria-label="Previous image"
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                  onClick={() => setSelected((selected + 1) % images.length)}
                  aria-label="Next image"
                >
                  <ChevronRight className="size-5" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
