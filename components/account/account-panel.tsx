import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * アカウント下位節の共通部品 (節見出し / 行 / 空状態 / 読み込み中の骨組み)。
 *
 * マイページ本体 (`/ja/account`) は【R2: 確定版】(Figma 8095:731) に沿って
 * `components/account/account-parts.tsx` の帯・カードで組んである。一方、
 * お気に入り / フォロー / イベント申込 / LINE 連携ビューの 4 つは R2 より前の
 * 世代の造作 (罫線 1 本で区切る素朴な一覧) がそのまま残っていて、
 * **同じマークアップが 5 ファイル・節見出し 8 箇所に複製**されていた:
 *
 *   <section className="mb-12">
 *     <h2 className="text-lg mb-6 pb-3 border-b border-border">…</h2>
 *
 * 本ファイルはその重複を 1 箇所に集約する。**描画は現状のまま**で、
 * クラス構成・DOM 構造・寸法・色は 1 つも変えていない (data-slot だけを足して
 * 計測・QA で拾えるようにした)。R2 確定版の造作へ寄せるかどうかは Figma 側に
 * この 4 節の確定版が起きてからの判断で、ここでは触らない。
 *
 * 使い分け:
 * - 確定版の帯・カード (マイページ本体) … `account-parts.tsx`
 * - 旧世代の下位節 (本ファイル)          … `account-panel.tsx`
 */

/* -------------------------------------------------------------------------- */
/* AccountPanelSection — 節の器 + 節見出し                                     */
/* -------------------------------------------------------------------------- */

export function AccountPanelSection({
  title,
  testId,
  className,
  children,
}: {
  title: React.ReactNode;
  /** 既存の E2E が拾っている `data-testid` を保つための受け口 (LINE 連携節)。 */
  testId?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-slot="account-panel-section"
      data-testid={testId}
      className={cn("mb-12", className)}
    >
      <h2
        data-slot="account-panel-heading"
        className="text-lg mb-6 pb-3 border-b border-border"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountPanelList / AccountPanelRow — 罫線区切りの一覧                        */
/* -------------------------------------------------------------------------- */

/** 行を積む器。行どうしの溝は 4 (`space-y-1`) で、区切りは行側の下罫線が担う。 */
export function AccountPanelList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="account-panel-list" className={cn("space-y-1", className)}>
      {children}
    </div>
  );
}

/**
 * 一覧の 1 行。既定は罫線なしで、実データの行は `divided` で下罫線を引く
 * (読み込み中の骨組みは罫線を持たないため prop で分ける)。
 */
export function AccountPanelRow({
  divided = false,
  className,
  children,
}: {
  divided?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="account-panel-row"
      className={cn(
        "flex items-center gap-4 py-3",
        divided && "border-b border-border",
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountPanelEmpty — 0 件のとき (アイコン + 1 行)                            */
/* -------------------------------------------------------------------------- */

export function AccountPanelEmpty({
  icon,
  message,
}: {
  /** 節の性格を示すアイコン (お気に入り = Heart / フォロー = Users ほか)。 */
  icon?: React.ReactNode;
  message: React.ReactNode;
}) {
  return (
    <div
      data-slot="account-panel-empty"
      className="flex items-center gap-3 text-muted-foreground"
    >
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* AccountPanelSkeleton — 読み込み中の骨組み                                    */
/* -------------------------------------------------------------------------- */

export function AccountPanelSkeleton({
  rows,
  thumbClassName,
  lines = 2,
}: {
  /** 行数 (お気に入り 3 / フォロー・イベント 2)。 */
  rows: number;
  /** サムネの寸法・形 (角丸の有無が節によって違う)。 */
  thumbClassName: string;
  /** 文字行の本数 (フォローは名前 1 行のみ)。 */
  lines?: 1 | 2;
}) {
  return (
    <div data-slot="account-panel-skeleton" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <AccountPanelRow key={i} className="animate-pulse">
          <div className={cn("bg-muted", thumbClassName)} />
          <div className="flex-1 space-y-2">
            <div className={cn("h-4 bg-muted", lines === 1 ? "w-1/2" : "w-3/4")} />
            {lines === 2 ? <div className="h-3 bg-muted w-1/2" /> : null}
          </div>
        </AccountPanelRow>
      ))}
    </div>
  );
}
