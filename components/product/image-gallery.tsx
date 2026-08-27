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
import { mayPrefetchMedia } from "@/components/media/prefetch-policy";
import type { Image as ImageType } from "@/lib/shopify/types";

import { mergeWarm, zoomWarmTargets } from "./image-gallery-warm";

/** メイン画像の `sizes`。**先読みと本番の指定を必ず同じ文字列にする** (下記)。 */
const MAIN_SIZES = "(max-width: 1024px) 100vw, 50vw";
/** メイン画像の指定寸法。`MAIN_SIZES` と同じ理由で 1 箇所に置く。 */
const MAIN_EDGE = 800;
/**
 * ズーム (拡大表示) の `sizes` と指定寸法。メイン画像と**別の URL になる**ので
 * 1 箇所に置き、先読みと本番で同じ文字列を使う (違うと先読みが効かない)。
 */
const ZOOM_SIZES = "90vw";
const ZOOM_EDGE = 1200;

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
  /**
   * ズーム用 (1200px) を温めた写真の番号。**メイン画像 (800px) とは別の URL**
   * なので、そちらの先読みでは 1 枚も温まらない (`image-gallery-warm.ts`)。
   */
  const [zoomWarm, setZoomWarm] = useState<readonly number[]>([]);
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
    if (!mayPrefetchMedia()) return;

    const start = () => setPrefetch(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(start, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(start, 1000);
    return () => clearTimeout(id);
  }, [images.length]);

  /**
   * ズームで使う 1200px 版を**押される前に**取っておく (網羅表 G3 / B2 / B3)。
   *
   * 対象は「いま出ている 1 枚」だけ。ズームが開いているあいだは前へ / 次へで
   * 次に要る左右も足す。全部まとめて取らない理由と、温めた枚数を減らさない
   * 理由は `image-gallery-warm.ts` に書いてある。
   *
   * メイン画像の先読みと同じく手が空いてから始める — ここで急ぐと、いちばん
   * 大事な 1 枚目の表示 (LCP) と帯域を奪い合う。
   */
  useEffect(() => {
    if (images.length === 0) return;
    if (!mayPrefetchMedia()) return;

    const targets = zoomWarmTargets(selected, images.length, zoomOpen);
    if (targets.length === 0) return;

    const start = () => setZoomWarm((current) => mergeWarm(current, targets));
    /* ズームが開いているときは待たない。次に押されるのは隣の 1 枚で、しかも
       もう開いている = 客は写真を見に来ている、が確定しているため。 */
    if (zoomOpen) {
      start();
      return;
    }
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(start, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(start, 1000);
    return () => clearTimeout(id);
  }, [images.length, selected, zoomOpen]);

  /** 待たずに今すぐ温める (押す仕草が見えたとき用)。 */
  const warmZoomNow = () => {
    if (!mayPrefetchMedia()) return;
    const targets = zoomWarmTargets(selected, images.length, zoomOpen);
    if (targets.length === 0) return;
    setZoomWarm((current) => mergeWarm(current, targets));
  };

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
        /* 押す仕草が見えた時点で 1200px 版を取りにいく。手が空くのを待つ
           `requestIdleCallback` がまだ流れていないうちに押された場合の保険で、
           `pointerdown` は `click` より前に出るので指で触った場合にも効く。
           既に温めてあれば `mergeWarm` が同じ配列を返すので何も起きない。 */
        onPointerEnter={() => warmZoomNow()}
        onPointerDown={() => warmZoomNow()}
        onFocus={() => warmZoomNow()}
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
        <div className="sr-only" aria-hidden data-slot="gallery-prefetch-main">
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

      {/* ズーム用 (1200px) の先読み。**メイン画像とは別の URL** なので上の枠では
          1 枚も温まらない (網羅表 G3)。`width` / `height` / `sizes` はズームの
          本番指定と完全に同じにすること — 1 文字でも違うと別の URL を取る。
          温める枚数は `zoomWarmTargets` が決める (全部は取らない)。 */}
      {zoomWarm.length > 0 && (
        <div className="sr-only" aria-hidden data-slot="gallery-prefetch-zoom">
          {zoomWarm.map((i) => (
            <Image
              key={i}
              src={images[i].url}
              alt=""
              width={ZOOM_EDGE}
              height={ZOOM_EDGE}
              sizes={ZOOM_SIZES}
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
              width={ZOOM_EDGE}
              height={ZOOM_EDGE}
              sizes={ZOOM_SIZES}
              data-slot="gallery-zoom-image"
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
