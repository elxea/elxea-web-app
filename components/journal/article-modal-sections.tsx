"use client";

import * as React from "react";

import { Link } from "@/i18n/navigation";
import { ImageCard } from "@/components/media/image-card";
import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { pillClass } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";

import { JournalModal, ModalDetailRow } from "./journal-modal";

/**
 * 記事詳細の「関連記事」「この記事に出てきた茶葉」を、ページを離れずに開く
 * モーダルへ接続する層。
 *
 * Figma が正本:
 * - 器          Modal (Module) 8172:280
 * - 中身 (読みもの) Modal / Body — この号のほかの読みもの (Slot) 8175:364
 * - 中身 (茶葉)     Modal / Body — 茶葉詳細 (Slot) 8184:365
 * - 適用例      8180:4728 / 8181:5289 / 8180:4866 / 8181:5366
 *
 * なぜモーダルか: 記事末尾で「関連記事をクリック → 別記事へ全面遷移 →
 * 戻ると元の記事の読了位置を失う」が起きていた。補足を見るだけなら
 * ページを離れさせない (Figma の注記「行き止まり回避が目的なので、開いた先でも
 * ページ遷移させず次の読みものへ連鎖できる形にする」)。
 *
 * deep-link は持たない (Wave 3 指示)。モーダルは閲覧補助であり到達先ではないので、
 * URL に状態を載せず、戻る操作は素直にページ遷移として働かせる。
 */

/* -------------------------------------------------------------------------- */
/* 共通 — related row (Figma 8175:365 / 記事末尾の行と同じ寸法)                 */
/* -------------------------------------------------------------------------- */

type Reading = {
  id: string;
  title: string;
  href: string;
  imageUrl?: string;
  /** カテゴリ名等の 1 行メタ。無ければ出さない (存在しない情報を作らない)。 */
  meta?: string;
};

/**
 * Figma 実測 (px) → 実装:
 * - 行高 72 (`h-18`) / py 8 (`py-2`) / gap 16 (`gap-4`)
 * - サムネ 56 角丸 radius-sm (`size-14 rounded-sm`)
 * - 見出し body-sm 14 / メタ caption 12
 * - 行間の hairline 1px (`bg-border`)
 */
function ReadingRow({
  reading,
  onSelect,
  className,
}: {
  reading: Reading;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="reading-row"
      onClick={onSelect}
      className={cn(
        "flex h-18 w-full items-center gap-4 py-2 text-left",
        "transition-colors duration-fast hover:bg-muted active:bg-secondary",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
    >
      <div className="size-14 shrink-0 overflow-hidden rounded-sm">
        <ImageCard
          image={reading.imageUrl}
          alt={reading.title}
          className="rounded-sm"
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn(bodySmClass, "text-foreground")}>{reading.title}</span>
        {reading.meta ? (
          <span className={cn(captionClass, "text-muted-foreground")}>{reading.meta}</span>
        ) : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* この号のほかの読みもの                                                        */
/* -------------------------------------------------------------------------- */

export type RelatedReadingsSectionProps = {
  /** セクション見出し (i18n 済み)。 */
  heading: string;
  readings: Reading[];
  labels: {
    /** モーダルのキッカー。 */
    kicker: string;
    close: string;
    /** フッター主導線。押すと記事へ遷移する。 */
    open: string;
    /** 連鎖できる読みものが他に無いときの案内。 */
    onlyOne: string;
  };
  className?: string;
};

/**
 * 関連記事の行を押すとモーダルが開き、フッターの主導線で初めてページ遷移する。
 * モーダルの中身は「その記事以外の読みもの」なので、開いたまま次々に対象を
 * 乗り換えられる (Figma 8175:364 の意図する連鎖)。
 */
export function RelatedReadingsSection({
  heading,
  readings,
  labels,
  className,
}: RelatedReadingsSectionProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  if (readings.length === 0) return null;

  const active = readings.find((r) => r.id === activeId) ?? null;
  const others = readings.filter((r) => r.id !== activeId);

  return (
    <section data-slot="related-readings" className={cn("mt-6", className)}>
      <p className={cn(captionClass, "text-muted-foreground")}>{heading}</p>
      <ul className="mt-2">
        {readings.map((reading) => (
          <li key={reading.id}>
            <ReadingRow reading={reading} onSelect={() => setActiveId(reading.id)} />
          </li>
        ))}
      </ul>

      <JournalModal
        open={active !== null}
        onOpenChange={(next) => {
          if (!next) setActiveId(null);
        }}
        kicker={labels.kicker}
        title={active?.title ?? ""}
        closeLabel={labels.close}
        primaryAction={
          active ? (
            <Link
              href={active.href}
              className={pillClass("solid", "flex-1 lg:flex-none")}
            >
              {labels.open}
            </Link>
          ) : undefined
        }
      >
        {others.length > 0 ? (
          <ul className="w-full">
            {others.map((reading) => (
              <li key={reading.id}>
                <ReadingRow reading={reading} onSelect={() => setActiveId(reading.id)} />
                <span aria-hidden="true" className="block h-px w-full bg-border" />
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn(bodySmClass, "text-muted-foreground")}>{labels.onlyOne}</p>
        )}
      </JournalModal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* この記事に出てきた茶葉                                                        */
/* -------------------------------------------------------------------------- */

export type TeaSpecRow = { label: string; value: string };

export type TeaDetail = {
  id: string;
  title: string;
  href: string;
  imageUrl?: string;
  /** 行に出す 1 行メタ (商品種別など)。 */
  meta?: string;
  /** モーダル本文の導入テキスト。 */
  description?: string;
  /** Figma TeaSpecCard の dl。値がある項目だけを渡すこと。 */
  spec: TeaSpecRow[];
  /**
   * 「さらに潜る」行。押すとモーダル内で本文が開く (ページ遷移しない)。
   * Figma 8175:351 の階層リンクに対応。
   */
  details: { id: string; label: string; body: string }[];
};

export type TeaDetailSectionProps = {
  heading: string;
  teas: TeaDetail[];
  labels: {
    kicker: string;
    close: string;
    /** フッター主導線 (商品ページへ)。 */
    toProduct: string;
  };
  className?: string;
};

export function TeaDetailSection({
  heading,
  teas,
  labels,
  className,
}: TeaDetailSectionProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [openDetailId, setOpenDetailId] = React.useState<string | null>(null);

  if (teas.length === 0) return null;

  const active = teas.find((t) => t.id === activeId) ?? null;

  return (
    <section data-slot="tea-details" className={cn("mt-6", className)}>
      <p className={cn(captionClass, "text-muted-foreground")}>{heading}</p>
      <ul className="mt-4 space-y-4">
        {teas.map((tea) => (
          <li key={tea.id}>
            <button
              type="button"
              onClick={() => {
                setActiveId(tea.id);
                setOpenDetailId(null);
              }}
              className={cn(
                "flex w-full gap-4 text-left lg:gap-6",
                "transition-colors duration-fast hover:bg-muted active:bg-secondary",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              )}
            >
              <span className="block w-24 shrink-0 lg:w-40">
                <ImageCard
                  image={tea.imageUrl}
                  alt={tea.title}
                  style={{ aspectRatio: "1/1" }}
                />
              </span>
              <span className="flex flex-col justify-center gap-2">
                <span className="text-foreground">{tea.title}</span>
                {tea.meta ? (
                  <span className={cn(captionClass, "hidden text-muted-foreground lg:block")}>
                    {tea.meta}
                  </span>
                ) : null}
                <span className={cn(bodySmClass, "flex h-12 items-center text-foreground underline underline-offset-4")}>
                  {labels.toProduct}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <JournalModal
        open={active !== null}
        onOpenChange={(next) => {
          if (!next) {
            setActiveId(null);
            setOpenDetailId(null);
          }
        }}
        kicker={labels.kicker}
        title={active?.title ?? ""}
        closeLabel={labels.close}
        primaryAction={
          active ? (
            <Link href={active.href} className={pillClass("solid", "flex-1 lg:flex-none")}>
              {labels.toProduct}
            </Link>
          ) : undefined
        }
      >
        {active ? (
          // PC は TeaSpecCard をそのまま置き右に本文、SP はヒーロー写真を持たず
          // 96px サムネ + スペックへ組み替える (Figma 8184:365 の注記どおり。
          // SP でヒーロー写真を出すとシートが画面高を超え、フッター =
          // 閉じる導線が親指到達域から外れる)。
          <div className="flex w-full flex-col gap-4 lg:flex-row lg:gap-6">
            {/* --- PC: TeaSpecCard (写真 + dl) --- */}
            <div className="hidden shrink-0 overflow-hidden rounded-md border border-border bg-background lg:block lg:w-86.5">
              <ImageCard
                image={active.imageUrl}
                alt={active.title}
                className="rounded-none"
                style={{ aspectRatio: "1/1" }}
              />
              {active.spec.length > 0 ? (
                <dl className={cn(captionClass, "flex flex-col gap-1.5 px-4 py-3")}>
                  {active.spec.map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-4">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="text-right text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>

            {/* --- SP: 96px サムネ + 見出し行 --- */}
            <div className="flex items-center gap-4 lg:hidden">
              <div className="size-24 shrink-0 overflow-hidden rounded-md">
                <ImageCard
                  image={active.imageUrl}
                  alt={active.title}
                  className="rounded-md"
                  style={{ aspectRatio: "1/1" }}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className={cn(bodySmClass, "text-foreground")}>{active.title}</p>
                {active.meta ? (
                  <p className={cn(captionClass, "text-muted-foreground")}>{active.meta}</p>
                ) : null}
              </div>
            </div>
            {active.spec.length > 0 ? (
              <dl className={cn(captionClass, "flex flex-col gap-1.5 lg:hidden")}>
                {active.spec.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {/* --- 本文 + 階層リンク (PC は右カラム / SP は下に続く) --- */}
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {active.description ? (
                <p className="text-foreground">{active.description}</p>
              ) : null}
              {active.details.length > 0 ? (
                <div className="flex w-full flex-col">
                  {active.details.map((detail) => (
                    <React.Fragment key={detail.id}>
                      <ModalDetailRow
                        label={detail.label}
                        aria-expanded={openDetailId === detail.id}
                        className={cn(bodySmClass)}
                        onClick={() =>
                          setOpenDetailId((current) =>
                            current === detail.id ? null : detail.id
                          )
                        }
                      />
                      {openDetailId === detail.id ? (
                        <p className={cn(bodySmClass, "py-3 text-muted-foreground")}>
                          {detail.body}
                        </p>
                      ) : null}
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </JournalModal>
    </section>
  );
}
