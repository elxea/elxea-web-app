import Image from "next/image";

/**
 * ImagePlaceholder — Unified fallback for missing images.
 *
 * Displays the elxea logo at low opacity on a muted background.
 * Used across all image containers when no image is available.
 */
export function ImagePlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-muted">
      <Image
        src="/logo.png"
        alt=""
        width={80}
        height={19}
        className="opacity-10 select-none pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}
