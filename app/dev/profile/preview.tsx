"use client";

/**
 * `/dev/profile` の面切替 (お茶 / 読み物 / イベント) とカテゴリー切替
 * (緑茶 / 紅茶 / 青茶) だけを持つ薄いクライアント層。中身の描画・データ取得は
 * すべて `ProfileStageBlock` に委ねる。
 */

import { useState } from "react";

import { ProfileStageBlock } from "@/components/viz/profile/profile-stage-block";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";

const FACETS: Array<{ value: ProfileFacet; label: string }> = [
  { value: "tea", label: "お茶" },
  { value: "reading", label: "読み物" },
  { value: "event", label: "イベント" },
];

const CATEGORIES: Array<{ value: TeaCategory; label: string }> = [
  { value: "green", label: "緑茶" },
  { value: "red", label: "紅茶" },
  { value: "oolong", label: "青茶" },
];

export function ProfileDevPreview() {
  const [facet, setFacet] = useState<ProfileFacet>("tea");
  const [category, setCategory] = useState<TeaCategory>("green");

  return (
    <div style={{ fontFamily: ROJI_VIZ_SERIF, color: ROJI_VIZ_COLOR.sumi }}>
      <div role="tablist" aria-label="面の切替" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {FACETS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={facet === f.value}
            onClick={() => setFacet(f.value)}
            style={{
              minHeight: 44,
              padding: "0 16px",
              border: `1px solid ${ROJI_VIZ_COLOR.suna}`,
              background: facet === f.value ? ROJI_VIZ_COLOR.kinari : "transparent",
              color: ROJI_VIZ_COLOR.sumi,
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {facet === "tea" && (
        <div role="group" aria-label="カテゴリーの切替" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
              style={{
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${ROJI_VIZ_COLOR.suna}`,
                background: category === c.value ? ROJI_VIZ_COLOR.koke : "transparent",
                color: category === c.value ? ROJI_VIZ_COLOR.kinari : ROJI_VIZ_COLOR.sumi,
                cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ height: 560, border: `1px solid ${ROJI_VIZ_COLOR.suna}` }}>
        <ProfileStageBlock
          key={`${facet}-${category}`}
          label={`roji プロファイル — ${facet === "tea" ? "味わいの地" : "言葉の野"}`}
          facet={facet}
          category={facet === "tea" ? category : undefined}
        />
      </div>
    </div>
  );
}
