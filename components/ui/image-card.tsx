import Image, { type StaticImageData } from "next/image";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { cn } from "@/lib/utils";
import { sanitizeImageUrl } from "@/lib/image-utils";

type ImageCardProps = {
  /** Image source — URL string or StaticImageData. Omit for placeholder. */
  image?: string | StaticImageData;
  /** Alt text for the image */
  alt?: string;
  /** CSS aspect-ratio value (default "3/2") */
  aspectRatio?: string;
  /** Additional CSS classes on the outer container */
  className?: string;
  /** Image width hint for next/image (default 600) */
  width?: number;
  /** Image height hint for next/image (default 400) */
  height?: number;
  /** Sizes attribute for responsive images */
  sizes?: string;
  /** Priority loading */
  priority?: boolean;
  /** Enable group-hover scale effect on image (default false) */
  hover?: boolean;
  /** Inline styles on the outer container (merged with aspectRatio) */
  style?: React.CSSProperties;
  /** Children rendered inside the container (overrides default image rendering) */
  children?: React.ReactNode;
};

/**
 * ImageCard -- Unified image frame component.
 *
 * Provides consistent aspect-ratio, rounded corners, overflow clipping,
 * and muted background across the entire app.
 *
 * Usage:
 *   <ImageCard image={url} alt="..." />           // with image
 *   <ImageCard />                                  // placeholder only
 *   <ImageCard aspectRatio="16/9">{custom}</ImageCard>  // custom children
 */
export function ImageCard({
  image,
  alt = "",
  aspectRatio = "3/2",
  className,
  width = 600,
  height = 400,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  priority,
  hover,
  style,
  children,
}: ImageCardProps) {
  return (
    <div
      className={cn("bg-muted overflow-hidden rounded-md", className)}
      style={{ aspectRatio, ...style }}
    >
      {children ? (
        children
      ) : image && (typeof image !== "string" || sanitizeImageUrl(image)) ? (
        <Image
          src={image}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          className={cn(
            "w-full h-full object-cover",
            hover && "transition-transform duration-500 group-hover:scale-105",
          )}
          priority={priority}
        />
      ) : (
        <ImagePlaceholder />
      )}
    </div>
  );
}
