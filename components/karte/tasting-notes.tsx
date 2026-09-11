import * as React from "react";

import { Link } from "@/i18n/navigation";
import { bodySmClass, h4Class } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * テイスティングノート (飲んだ記録) — Figma【R2: 確定版】お茶カルテ の
 * `TastingNotes (飲んだ記録 / EC テイスティングノート統合)` ブロック。
 * PC `8105:1125` (896x652) / SP `8105:1262` (343x718)。
 *
 * ## なぜ「お茶カルテ」由来なのか
 *
 * Structure DB の「テイスティングノート」行 (`/ja/tasting-note`) が持つ Figma
 * ノード `6728:120` は **旧 elxea 変A 世代** (`テイスティングノート 変A（部品ベース）
 * — PC/SP @/ja/tasting-note`) で R2 ではない。R2 確定版セクションの全数走査
 * (page 7567:2 / 4 / 6 / 8 / 9 / 10 / 11 / 12 / 13 / 3 + roji Proposals・Layouts) を
 * かけると、roji R2 には **テイスティングノート単独のフレームが無い**。代わりに
 * お茶カルテ R2 (`8105:1116`) の中に「EC テイスティングノート統合」と明記された
 * ブロックがあり、そこが R2 における本画面の正本になっている。
 * よって寸法・色・字送りの正本は `8105:1125` / `8105:1262`。
 *
 * ## Figma 実測 (px) → 実装の対応
 *
 * | 項目 | PC 8105:1127 | SP 8105:1264 | 実装 |
 * |---|---|---|---|
 * | カード | 896x130 / pad 24 / gap 24 (横) | 343x194 / pad 16 / gap 12 (縦) | `p-4 lg:p-6` + grid |
 * | 面 | `card` #f4f3ed | 同 | `bg-card` |
 * | 角丸 | 4 | 4 | `rounded-sm` (= radius 8 - 4) |
 * | 写真 | 80x80 / `secondary` #d5d3c0 | 64x64 | `size-16 lg:size-20 bg-secondary` |
 * | 日付 | 14 / lh 25.2 / `muted-foreground` | 同 | `bodySmClass` |
 * | 銘柄 | 16 / 500 / `foreground` | 同 | `h4Class` |
 * | ひとこと | 14 / lh 25.2 / `muted-foreground` | 同 (行を落として全幅 311) | `bodySmClass` + grid 配置 |
 * | チップ | pad 8/16 / h41 | pad 12/16 / h49 | `px-4 py-3 lg:py-2` |
 *
 * ## なぜ grid なのか (SP と PC で「ひとこと」の位置が違う)
 *
 * PC は 写真 | (日付・銘柄・ひとこと) | チップ の 3 列。SP は 1 行目に
 * 写真 + (日付・銘柄)、2 行目に **写真の下まで回り込んだ全幅のひとこと**、
 * 3 行目にチップ。同じ文字列を `hidden` で 2 回描くと読み上げが二重になるので、
 * grid の明示配置で 1 ノードのまま行を移す。
 *
 * @see docs/fidelity/c13-1-fidelity.md 忠実度対比表 (PC / SP)
 */

/** 記録の「手ざわり」。R2 のチップ 3 種に対応 (`8105:1133` / `8105:1141` / `8105:1149`)。 */
export type TastingNoteMood = "again" | "matched" | "logged";

export type TastingNoteRecord = {
  /** 一覧内で一意。 */
  readonly id: string;
  /** 表示用に整形済みの日付 (例「8月26日」)。整形は呼び出し側の責務。 */
  readonly date: string;
  /** 銘柄 (例「焙じ茶 — 秋摘み」)。 */
  readonly title: string;
  /** ひとこと。無ければ行ごと出さない。 */
  readonly note?: string;
  /** 手ざわり。無ければチップごと出さない。 */
  readonly mood?: TastingNoteMood;
  /** 写真。無ければ `secondary` の面だけを置く (R2 の写真枠は無地)。 */
  readonly image?: { readonly src: string; readonly alt: string };
  /** 記録の詳細 (茶葉ページなど) へ。無ければ非リンクで描く。 */
  readonly href?: string;
};

/* -------------------------------------------------------------------------- */
/* DiaryChip — 手ざわりのチップ (R2 8105:1133 塗り / 8105:1149 線)              */
/* -------------------------------------------------------------------------- */

/**
 * R2 は「また淹れたい」「合っていた」を塗り (面 #464748 / 文字 #ebe9e0)、
 * 「記録だけ」を線 (罫 #adaca0 / 文字 #464748) で描き分ける。
 *
 * 色は DS トークンに束ねる: 塗り = `bg-primary text-primary-foreground`、
 * 線 = `border-border text-foreground`。Figma の生値との差 2 件 (文字 #ebe9e0 →
 * `primary-foreground` #f9f8f4 / 罫 #adaca0 → `border` #888675) は
 * **トークン整合側が正**。どちらも Figma Variable の実値 (`get_variable_defs`
 * 2026-08-09 / node 8109:46558) に合わせて DS を是正した結果で、罫線を
 * `border-border` に束ねるのは C6-3R の先例と同じ。忠実度表に [DS案件] で記載。
 */
function DiaryChip({ mood, label }: { mood: TastingNoteMood; label: string }) {
  const filled = mood !== "logged";
  return (
    <span
      data-slot="diary-chip"
      data-mood={mood}
      className={cn(
        bodySmClass,
        "inline-flex items-center rounded-sm px-4 py-3 lg:py-2",
        filled
          ? "bg-primary text-primary-foreground"
          : "border border-border text-foreground",
      )}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* DiaryCard — 1 件の記録 (R2 PC 8105:1127 / SP 8105:1264)                      */
/* -------------------------------------------------------------------------- */

export type DiaryCardProps = {
  record: TastingNoteRecord;
  /** 手ざわりの表示名 (i18n 済み)。 */
  moodLabel?: string;
};

export function DiaryCard({ record, moodLabel }: DiaryCardProps) {
  const { date, title, note, mood, image, href } = record;

  const body = (
    <>
      {/* 写真: PC は 2 行にまたがって縦中央 / SP は 1 行目のみ。 */}
      <span
        data-slot="diary-photo"
        aria-hidden={image ? undefined : true}
        className="size-16 shrink-0 overflow-hidden rounded-sm bg-secondary lg:size-20 lg:row-span-2"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 記録の写真は外部 CDN 由来で寸法が固定 (80/64 の正方形)。next/image の最適化は不要で、カルテ側と同じ素の img で揃える。
          <img
            src={image.src}
            alt={image.alt}
            width={80}
            height={80}
            className="size-full object-cover"
          />
        ) : null}
      </span>

      {/* 日付 + 銘柄 (R2 body の gap 4)。 */}
      <span data-slot="diary-body" className="flex min-w-0 flex-col gap-1">
        <span className={cn(bodySmClass, "text-muted-foreground")}>{date}</span>
        <span className={cn(h4Class, "text-foreground")}>{title}</span>
      </span>

      {/* ひとこと: PC は銘柄の下 (col 2 / row 2) / SP は全幅で 2 行目。 */}
      {note ? (
        <span
          data-slot="diary-note"
          className={cn(
            bodySmClass,
            "col-span-2 text-muted-foreground lg:col-span-1 lg:col-start-2 lg:row-start-2",
          )}
        >
          {note}
        </span>
      ) : null}

      {/* チップ: PC は右端で縦中央 / SP は最下行の左寄せ。 */}
      {mood && moodLabel ? (
        <span
          className={cn(
            "col-span-2 justify-self-start",
            "lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-center lg:justify-self-end",
          )}
        >
          <DiaryChip mood={mood} label={moodLabel} />
        </span>
      ) : null}
    </>
  );

  /* grid-cols: SP 写真 64 + 残り / PC 写真 80 + 残り + チップ。
     gap は R2 実測どおり SP 縦 12・横 16 / PC 縦 4 (body の段間)・横 24。 */
  const className = cn(
    "grid grid-cols-[4rem_1fr] items-center gap-x-4 gap-y-3 rounded-sm bg-card p-4",
    "lg:grid-cols-[5rem_1fr_auto] lg:gap-x-6 lg:gap-y-1 lg:p-6",
  );

  if (href) {
    return (
      <Link data-slot="diary-card" href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="diary-card" className={className}>
      {body}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TastingNoteList — 見出し + 記録の縦積み + 「すべての記録を見る →」            */
/* -------------------------------------------------------------------------- */

export type TastingNoteListProps = {
  records: readonly TastingNoteRecord[];
  /** 手ざわり → 表示名。 */
  moodLabels: Readonly<Record<TastingNoteMood, string>>;
  /**
   * 「すべての記録を見る →」の遷移先とラベル。省略時は行ごと出さない。
   *
   * 見出しは**本コンポーネントの外**で組む。R2 のブロック見出し
   * (`8105:1126` PC 20 / `8105:1263` SP 16) は h2 要素だが、`globals.css` の
   * unlayered な `h2 { font: … }` が Tailwind utilities に勝つため utility
   * クラスでは体裁が当たらない (`SectionHead` が
   * `h2[data-slot="section-title"]` 規則を使っているのと同じ制約)。
   * 単独ページ (`/ja/tasting-note`) は `ListPageHead` の h1 が主見出しになり、
   * お茶カルテ (`/ja/karte`) に埋め込む側は `SectionHead` を使えばよいので、
   * ここに独自の見出し機構を作らない。
   */
  more?: { readonly href: string; readonly label: string };
  className?: string;
};

export function TastingNoteList({
  records,
  moodLabels,
  more,
  className,
}: TastingNoteListProps) {
  /* データが無い節は枠ごと出さない (全体裁定)。空の見出しやカード枠を残さない。 */
  if (records.length === 0) return null;

  return (
    <div
      data-slot="tasting-note-list"
      className={cn("flex flex-col gap-4", className)}
    >
      {records.map((record) => (
        <DiaryCard
          key={record.id}
          record={record}
          moodLabel={record.mood ? moodLabels[record.mood] : undefined}
        />
      ))}

      {more ? (
        <Link
          data-slot="tasting-note-more"
          href={more.href}
          className={cn(bodySmClass, "text-foreground hover:opacity-70")}
        >
          {more.label}
        </Link>
      ) : null}
    </div>
  );
}
