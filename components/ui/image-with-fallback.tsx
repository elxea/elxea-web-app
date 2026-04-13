'use client';

import { useState } from 'react';
import Image, { type ImageProps } from 'next/image';

interface ImageWithFallbackProps extends Omit<ImageProps, 'onError'> {
  fallbackSrc?: string;
}

/**
 * ImageWithFallback -- Development-friendly Image component
 *
 * Handles missing images gracefully by showing a fallback/placeholder.
 * In production, uses the original src. In development, falls back to placeholder.
 * This allows layout testing even when backend images aren't available.
 */
export function ImageWithFallback({
  src,
  fallbackSrc = '/placeholder-hero-day.jpg',
  ...props
}: ImageWithFallbackProps) {
  const [imgSrc, setImgSrc] = useState<string>(
    typeof src === 'string' ? src : (src as any).src || ''
  );

  const handleError = () => {
    // Only use fallback in development or when image fails to load
    if (typeof src === 'string' && !src.startsWith('http')) {
      // Local path that doesn't exist - use fallback
      setImgSrc(fallbackSrc);
    }
  };

  return (
    <Image
      {...props}
      src={imgSrc}
      onError={handleError}
    />
  );
}
