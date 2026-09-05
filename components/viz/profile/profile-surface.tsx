"use client";

/**
 * roji プロファイル (ミクロ⇔マクロ) の面切替とカテゴリー切替。
 *
 * ## なぜ「板 (ProfileStage)」と別の層なのか
 *
 * 板は canvas の中だけを描き、canvas の中にボタンを描かない (Spec §「操作・
 * アクセシビリティ」)。よって「どの面を見るか」「どのカテゴリーを見るか」を選ぶ
 * 実ボタンは板の外に要る。その外側だけを持つのがこの層で、データ取得も描画も
 * 一切知らない (すべて `ProfileStageBlock` → `ProfileStage` に委ねる)。
 *
 * ## なぜ文言を props で受けるのか (ここが単一正本の要)
 *
 * この面は 2 か所から使われる。
 *
 *   - `/{locale}/profile`  … 正式ページ。文言は next-intl の `messages/*.json`
 *   - `/dev/profile`       … 実装確認用。`app/dev/` は `[locale]` の外にあり
 *                            `NextIntlClientProvider` の内側ではないので、
 *                            `useTranslations()` を呼ぶと実行時に落ちる
 *
 * ここで `useTranslations()` を直接呼ぶと `/dev/profile` が壊れ、逆に日本語を
 * べた書きすると `/{locale}/profile` の英語が出ない。**振る舞いはこの 1 ファイル、
 * 文言は呼び出し側**、という切り方だけが両方を満たす。切替の実装を 2 つに複製
 * しない (単一正本)。
 */

import { useState } from "react";

import { ProfileStageBlock } from "@/components/viz/profile/profile-stage-block";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";

const FACET_ORDER: ProfileFacet[] = ["tea", "reading", "event"];
const CATEGORY_ORDER: TeaCategory[] = ["green", "red", "oolong"];

export interface ProfileSurfaceLabels {
  /** 面の切替 (tablist) の説明。画面には出さずスクリーンリーダーだけが読む。 */
  facetGroup: string;
  /** カテゴリー切替 (group) の説明。同上。 */
  categoryGroup: string;
  /** 面のボタンに出す文字。 */
  facets: Record<ProfileFacet, string>;
  /** カテゴリーのボタンに出す文字。 */
  categories: Record<TeaCategory, string>;
  /** 板そのものの説明 (`role="img"` の `aria-label`)。面ごとに変わる。 */
  stage: Record<ProfileFacet, string>;
  /** 倍率スライダーの説明。 */
  zoom: string;
}

export interface ProfileSurfaceProps {
  labels: ProfileSurfaceLabels;
  className?: string;
}

export function ProfileSurface({ labels, className }: ProfileSurfaceProps) {
  const [facet, setFacet] = useState<ProfileFacet>("tea");
  const [category, setCategory] = useState<TeaCategory>("green");

  return (
    <div className={className} style={{ fontFamily: ROJI_VIZ_SERIF, color: ROJI_VIZ_COLOR.sumi }}>
      <div
        role="tablist"
        aria-label={labels.facetGroup}
        data-slot="profile-facet-tablist"
        style={{ display: "flex", gap: 8, marginBottom: 12 }}
      >
        {FACET_ORDER.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={facet === value}
            data-slot={`profile-facet-tab-${value}`}
            onClick={() => setFacet(value)}
            style={{
              minHeight: 44,
              padding: "0 16px",
              border: `1px solid ${ROJI_VIZ_COLOR.suna}`,
              background: facet === value ? ROJI_VIZ_COLOR.kinari : "transparent",
              color: ROJI_VIZ_COLOR.sumi,
              cursor: "pointer",
            }}
          >
            {labels.facets[value]}
          </button>
        ))}
      </div>

      {/* カテゴリーは「お茶」の面だけが持つ (読み物・イベントに緑茶/紅茶は無い)。 */}
      {facet === "tea" && (
        <div
          role="group"
          aria-label={labels.categoryGroup}
          data-slot="profile-category-group"
          style={{ display: "flex", gap: 8, marginBottom: 12 }}
        >
          {CATEGORY_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              data-slot={`profile-category-chip-${value}`}
              onClick={() => setCategory(value)}
              style={{
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${ROJI_VIZ_COLOR.suna}`,
                background: category === value ? ROJI_VIZ_COLOR.koke : "transparent",
                color: category === value ? ROJI_VIZ_COLOR.kinari : ROJI_VIZ_COLOR.sumi,
                cursor: "pointer",
              }}
            >
              {labels.categories[value]}
            </button>
          ))}
        </div>
      )}

      {/* `key` を面 × カテゴリーで変えるのは、板が持つカメラ状態 (倍率) を
          切替のたびに初期化するため。持ち越すと「別の面を、前の面の倍率で
          見ている」状態になり、自分が中心という前提が読めなくなる。 */}
      <div className="h-120 lg:h-160" style={{ border: `1px solid ${ROJI_VIZ_COLOR.suna}` }}>
        <ProfileStageBlock
          key={`${facet}-${category}`}
          className="h-full"
          label={labels.stage[facet]}
          zoomLabel={labels.zoom}
          facet={facet}
          category={facet === "tea" ? category : undefined}
        />
      </div>
    </div>
  );
}
