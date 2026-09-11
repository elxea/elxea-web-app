/**
 * HeroSection — Business Component
 *
 * Reusable Hero section with 12 Variant support (Bg × Size).
 * Figma ComponentSet: https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=5162-122
 * Section Container: https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=5171-26
 *
 * Variant matrix:
 *   Bg: cream | sand | white | dark
 *   Size: L | M | S
 *
 * Token binding:
 *   Background → color.brand.{cream|sand|white|graphite} → --color-brand-{*} (tokens/base.json)
 *   Foreground → color.semantic.{foreground|primary-foreground} → --color-{*}
 *   Typography → typography.style.{display|h1|body-lg|body} → --typography-style-{*}
 *   Spacing → spacing.{24|16|10} → --spacing-{*}
 *   Container → layout.container.{2xl|xl|lg} → --layout-container-{*}
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeroBg = "cream" | "sand" | "white" | "dark";
export type HeroSize = "L" | "M" | "S";

export interface HeroSectionProps extends VariantProps<typeof heroSectionVariants> {
  /** Section title — primary display text */
  title: React.ReactNode;
  /** Eyebrow label above title (overline style) */
  eyebrow?: string;
  /** Body copy below title */
  description?: React.ReactNode;
  /** Primary CTA label */
  ctaLabel?: string;
  /** Primary CTA href or click handler */
  ctaHref?: string;
  onCtaClick?: () => void;
  /** Secondary CTA */
  ctaSecondaryLabel?: string;
  ctaSecondaryHref?: string;
  onCtaSecondaryClick?: () => void;
  /** Background image src (optional — if not provided, uses bg color) */
  imageSrc?: string;
  /** alt text for background image (decorative → empty string) */
  imageAlt?: string;
  /** Layout alignment */
  align?: "center" | "left";
  /** Additional className override */
  className?: string;
  /** aria-label for the <section> landmark */
  "aria-label"?: string;
}

// ---------------------------------------------------------------------------
// CVA variants — token-backed only, no hardcoded values
// ---------------------------------------------------------------------------

const heroSectionVariants = cva(
  // base: full-width section, flex-center, relative for bg image
  "relative w-full flex items-center justify-center overflow-hidden",
  {
    variants: {
      /**
       * bg: maps to design token --color-brand-{name}
       *   cream → oklch(0.933 0.012 96.4)  gray-20 #ebe9e0
       *   sand  → oklch(0.863 0.026 102.0) gray-40 #d5d3c0
       *   white → oklch(1 0 0)             #ffffff
       *   dark  → oklch(0.397 0.002 247.9) gray-120 #464748 (graphite)
       */
      bg: {
        cream: "bg-brand-cream",
        sand:  "bg-brand-sand",
        white: "bg-brand-white",
        dark:  "bg-brand-graphite",
      },
      /**
       * size: maps to spacing scale from tokens/base.json
       *   L → py-24 (--spacing-24 = 6rem), container xl (--layout-container-xl = 82rem)
       *   M → py-16 (--spacing-16 = 4rem), container lg (--layout-container-lg = 64rem)
       *   S → py-10 (--spacing-10 = 2.5rem), container md (--layout-container-md = 48rem)
       */
      size: {
        L: "py-24 min-h-[72vh]",
        M: "py-16 min-h-[52vh]",
        S: "py-10 min-h-[36vh]",
      },
    },
    defaultVariants: {
      bg: "cream",
      size: "L",
    },
  }
);

// Inner container max-width by size
const containerMaxWidthVariants = cva("relative z-10 w-full mx-auto px-6", {
  variants: {
    size: {
      L: "max-w-[var(--layout-container-xl)]",
      M: "max-w-[var(--layout-container-lg)]",
      S: "max-w-[var(--layout-container-md)]",
    },
  },
  defaultVariants: {
    size: "L",
  },
});

// Eyebrow: overline token (--typography-style-overline)
const eyebrowVariants = cva(
  // font shorthand from --typography-style-overline = 600 0.75rem/1.5 aktiv-grotesk-extended
  "uppercase tracking-[var(--typography-letterSpacing-widest)] font-[var(--typography-weight-semibold)] text-[length:var(--typography-size-xs)] leading-[var(--typography-lineHeight-normal)] mb-6 font-[family-name:var(--typography-family-heading)]",
  {
    variants: {
      bg: {
        cream: "text-muted-foreground",
        sand:  "text-muted-foreground",
        white: "text-muted-foreground",
        dark:  "text-primary-foreground/70",
      },
    },
    defaultVariants: {
      bg: "cream",
    },
  }
);

// Title: display or h1 token depending on size
const titleVariants = cva(
  "font-[family-name:var(--typography-family-heading)]",
  {
    variants: {
      bg: {
        cream: "text-primary",
        sand:  "text-primary",
        white: "text-primary",
        dark:  "text-primary-foreground",
      },
      size: {
        // L: display token (2.75rem/1.2 weight-300)
        L: "text-[length:var(--typography-size-5xl)] font-[var(--typography-weight-light)] leading-[var(--typography-lineHeight-tight)] tracking-[var(--typography-letterSpacing-tight)] mb-8",
        // M: h1 token (2rem/1.3 weight-300)
        M: "text-[length:var(--typography-size-4xl)] font-[var(--typography-weight-light)] leading-[var(--typography-lineHeight-snug)] tracking-normal mb-6",
        // S: h2 token (1.5rem/1.3 weight-400)
        S: "text-[length:var(--typography-size-2xl)] font-[var(--typography-weight-normal)] leading-[var(--typography-lineHeight-snug)] tracking-normal mb-4",
      },
    },
    defaultVariants: {
      bg: "cream",
      size: "L",
    },
  }
);

// Description: body-lg or body depending on size
const descriptionVariants = cva(
  "font-[family-name:var(--typography-family-sans)] leading-[var(--typography-lineHeight-relaxed)] tracking-[var(--typography-letterSpacing-wide)]",
  {
    variants: {
      bg: {
        cream: "text-foreground/80",
        sand:  "text-foreground/80",
        white: "text-foreground/80",
        dark:  "text-primary-foreground/80",
      },
      size: {
        L: "text-[length:var(--typography-size-lg)] mb-10 max-w-xl",
        M: "text-[length:var(--typography-size-base)] mb-8 max-w-lg",
        S: "text-[length:var(--typography-size-sm)] mb-6 max-w-md",
      },
    },
    defaultVariants: {
      bg: "cream",
      size: "L",
    },
  }
);

// CTA container
const ctaGroupVariants = cva("flex flex-wrap gap-3", {
  variants: {
    align: {
      center: "justify-center",
      left:   "justify-start",
    },
  },
  defaultVariants: {
    align: "center",
  },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * HeroSection
 *
 * Renders a full-width hero section. Supports 12 design variants via
 * `bg` (cream / sand / white / dark) and `size` (L / M / S) props.
 * All visual tokens are sourced from `tokens/base.json` — no hardcoded values.
 *
 * @example
 * // Cream, Large, centered
 * <HeroSection
 *   bg="cream"
 *   size="L"
 *   eyebrow="Specialty Tea"
 *   title="Tea for Creativity."
 *   description="Discover single-origin teas from Japan's finest small farms."
 *   ctaLabel="Shop Now"
 *   ctaHref="/products"
 * />
 */
export function HeroSection({
  bg = "cream",
  size = "L",
  title,
  eyebrow,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
  ctaSecondaryLabel,
  ctaSecondaryHref,
  onCtaSecondaryClick,
  imageSrc,
  imageAlt = "",
  align = "center",
  className,
  "aria-label": ariaLabel,
}: HeroSectionProps) {
  const isDark = bg === "dark";

  return (
    <section
      aria-label={ariaLabel}
      className={cn(heroSectionVariants({ bg, size }), className)}
    >
      {/* Background image overlay */}
      {imageSrc && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={imageAlt}
            aria-hidden={!imageAlt || imageAlt === "" ? true : undefined}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Overlay — uses --overlay token from globals.css */}
          <div className="absolute inset-0 bg-overlay" />
        </>
      )}

      {/* Content container */}
      <div
        className={cn(
          containerMaxWidthVariants({ size }),
          align === "center" ? "text-center" : "text-left"
        )}
      >
        {/* Eyebrow */}
        {eyebrow && (
          <p className={eyebrowVariants({ bg })}>
            {eyebrow}
          </p>
        )}

        {/* Title */}
        <h1 className={titleVariants({ bg, size })}>
          {title}
        </h1>

        {/* Description */}
        {description && (
          <p
            className={cn(
              descriptionVariants({ bg, size }),
              align === "center" && "mx-auto"
            )}
          >
            {description}
          </p>
        )}

        {/* CTAs */}
        {(ctaLabel || ctaSecondaryLabel) && (
          <div className={ctaGroupVariants({ align })}>
            {ctaLabel && (
              <Button
                variant={isDark ? "secondary" : "default"}
                size={size === "S" ? "sm" : size === "M" ? "default" : "lg"}
                {...(ctaHref
                  ? { asChild: true }
                  : { onClick: onCtaClick })}
              >
                {ctaHref ? (
                  <a href={ctaHref}>{ctaLabel}</a>
                ) : (
                  ctaLabel
                )}
              </Button>
            )}
            {ctaSecondaryLabel && (
              <Button
                variant={isDark ? "outline" : "outline"}
                size={size === "S" ? "sm" : size === "M" ? "default" : "lg"}
                {...(ctaSecondaryHref
                  ? { asChild: true }
                  : { onClick: onCtaSecondaryClick })}
              >
                {ctaSecondaryHref ? (
                  <a href={ctaSecondaryHref}>{ctaSecondaryLabel}</a>
                ) : (
                  ctaSecondaryLabel
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export { heroSectionVariants };
