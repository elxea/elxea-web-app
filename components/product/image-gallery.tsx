"use client";

import { useEffect, useState } from "react";
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

/** メイン画像の `sizes`。**先読みと本番の指定を必ず同じ文字列にする** (下記)。 */
const MAIN_SIZES = "(max-width: 1024px) 100vw, 50vw";
/** メイン画像の指定寸法。`MAIN_SIZES` と同じ理由で 1 箇所に置く。 */
const MAIN_EDGE = 800;

/**
 * 客が通信量を惜しむ設定にしているか (データセーバー)。
 *
 * 押されるか分からない写真を先に取るのは、その設定への裏切りになる。対応して
 * いないブラウザでは分からないので `false` (= 先読みする) に倒す。
 */
function savesData(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true;
}

export function ImageGallery({ images }: { images: ImageType[] }) {
  const [selected, setSelected] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  /**
   * 残りの写真を裏で取り終えたか。**1 枚目を描き終えてから**始める。
   *
   * 最初の描画で 7 枚まとめて取りにいくと、いちばん大事な 1 枚目の表示
   * (LCP) と帯域を奪い合う。手が空いてから (`requestIdleCallback`) 動かす。
   */
  const [prefetch, setPrefetch] = useState(false);
  const t = useTranslations("common");

  /**
   * サムネイルを押してから大きい写真が出るまでの遅さの正体は、**その 1 枚を
   * そこで初めて取りにいっていること**だった (本番 bcce45e 実測 2026-08-27)。
   *
   * DOM にあるのは選択中の 1 枚だけで、他は 80px のサムネイルしか無い。押した
   * 瞬間に `_next/image` の未生成サイズを取りにいくので、初回は 705〜1,865ms
   * (うち TTFB が 628〜1,788ms — 画像の変換待ちで、通信量ではない) かかる。
   * 一度取ってあれば同じ操作が 19〜174ms で終わる。
   *
   * そこで、1 枚目が落ち着いたあとに残りを**押される前に**取っておく。
   * 通信量を惜しむ設定 (データセーバー) のときは何もしない。
   */
  useEffect(() => {
    if (images.length <= 1) return;
    if (savesData()) return;

    const start = () => setPrefetch(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(start, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(start, 1000);
    return () => clearTimeout(id);
  }, [images.length]);

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
          width={MAIN_EDGE}
          height={MAIN_EDGE}
          sizes={MAIN_SIZES}
          className="w-full h-full object-cover"
          priority
        />
      </button>

      {/* 押される前に取っておく分。
          **`width` / `height` / `sizes` はメイン画像と完全に同じにすること** —
          `next/image` はこの 3 つから `_next/image?...&w=` の候補を組み立てるので、
          1 文字でも違うと別の URL を取ることになり、押したときに先読みが効かない。
          `sizes` は要素の実寸ではなくメディア条件で解決されるので、`sr-only` で
          畳んであっても選ばれる候補は本番と同じになる。
          `loading="eager"` を明示するのは、既定の遅延読み込みだと「画面に入ったら
          取る」判定に委ねてしまい、いつ取られるかが決まらないため。 */}
      {prefetch && (
        <div className="sr-only" aria-hidden>
          {images.map((image, i) => (
            <Image
              key={i}
              src={image.url}
              alt=""
              width={MAIN_EDGE}
              height={MAIN_EDGE}
              sizes={MAIN_SIZES}
              loading="eager"
            />
          ))}
        </div>
      )}

      {/* Thumbnails —
          `scrollbar-none` は横スクロール列の共通指定 (app/globals.css)。
          スワイプもキーボード送りも従来どおりで、ブラウザのスクロールバー
          だけを出さない。 */}
      {images.length > 1 && (
        <div
          className="flex gap-3 overflow-x-auto scrollbar-none"
          role="listbox"
          aria-label="Product images"
        >
          {images.map((image, i) => (
            <Button
              key={i}
              variant="ghost"
              className={`w-20 h-20 p-0 flex-shrink-0 overflow-hidden border transition-all duration-fast ${
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
