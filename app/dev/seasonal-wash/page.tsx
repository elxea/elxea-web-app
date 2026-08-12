import type { Metadata } from "next";

import {
  TIMES_OF_DAY,
  normalizeMonth,
  seasonalPaletteFor,
  seasonalTempo,
  timeOfDayFromHour,
  type TimeOfDay,
} from "@/lib/viz/seasonal-palette";
import { clampTempo } from "@/lib/viz/seasonal-wash-motion";

import { SeasonalWashPreview } from "./preview";

/**
 * 季節のにじみ (SeasonalWash) のプレビュー面。
 *
 * 目的は 48 通り (12ヶ月 x 4時間帯) を実機で確認できるようにすること。
 * 本番のナビゲーションからはリンクしない。`app/dev/layout.tsx` で noindex。
 *
 * 例: /dev/seasonal-wash?month=10&timeOfDay=dusk&tempo=1.6&grain=0&seed=3
 */

export const metadata: Metadata = {
  title: "Seasonal Wash preview",
  robots: { index: false, follow: false },
};

// 既定値が「いま」なので、ビルド時に固定させない。
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTimeOfDay(
  value: string | undefined,
  fallback: TimeOfDay,
): TimeOfDay {
  const found = TIMES_OF_DAY.find((t) => t === value?.toLowerCase());
  return found ?? fallback;
}

export default async function SeasonalWashPreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const now = new Date();

  const monthParam = Number(first(params.month));
  const month = Number.isFinite(monthParam)
    ? normalizeMonth(monthParam)
    : now.getMonth() + 1;

  const timeOfDay = parseTimeOfDay(
    first(params.timeOfDay),
    timeOfDayFromHour(now.getHours()),
  );

  const tempoParam = Number(first(params.tempo));
  const tempo = clampTempo(
    Number.isFinite(tempoParam) ? tempoParam : seasonalTempo(now),
  );

  // 粒子は既定 on (v1)。切って比べたいときだけ ?grain=0 で落とす。
  const grainParam = first(params.grain);
  const grain = !(grainParam === "0" || grainParam === "false");

  const seedParam = Number(first(params.seed));
  const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : 1;

  return (
    <SeasonalWashPreview
      palette={seasonalPaletteFor(month, timeOfDay)}
      month={month}
      timeOfDay={timeOfDay}
      tempo={tempo}
      grain={grain}
      seed={seed}
    />
  );
}
