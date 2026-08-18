import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Container, Section } from "@/components/layout/container";
import { ScaleBar } from "@/components/community/scale-bar";
import { bodySmClass, captionClass, h4Class } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

import { NoteFeed, type SignsNote } from "./note-feed";

/**
 * みんなの気配 (/signs) — Figma【R1-B: Vivino のコミュニティノートを定石に】
 * PC 7835:554 / SP 7835:557 (file AWLnI0XF07e8rScuxPYPc7) の実装。
 *
 * 骨格 (PC 1440 実測):
 * - PageTitle 7838:38285 …… pt 96 / pb 32 / gap 20、h1 32px + lead 14px (w 640)
 * - Main 7838:38288 …… pt 48 / pb 96、4col (416) + 8col (864)、gap 32
 *   - 今週の集計 7838:38289 …… 縦 gap 40。Stat の数値は display 44px + 単位 16px
 *   - 時間帯 7838:38301 …… 行 gap 20 / 行内 gap 8 / ScaleBar 高 3
 *   - みんなの一言 7838:38331 …… head + NoteCard x6、gap 16
 * - この場所の決まりごと 7838:38407 …… py 96、3 カラム gap 32
 * - hairline 7838:38419 …… 全幅 1px
 * - 茶葉導線 7838:38420 …… p 64、リンク + 注記
 * SP 375 は同じ順序の 1 カラム積み上げ (外余白 16 / 節の上下 40)。
 *
 * 既知の差分 (忠実度対比表と対応):
 * - line-height は CJK トークン (typography.style.*) が正。Figma の h1 1.2 /
 *   body-sm 1.8 との差はトークン由来のため【仕様】。
 * - 集計値・一言は API 未配線。下の PLACEHOLDER 定数は Figma の見本値で、
 *   構造 (件数・並び) だけを Figma に合わせている。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signs");
  return {
    title: t("title"),
    description: t("lead"),
    openGraph: { title: t("title"), description: t("lead") },
  };
}

/** Figma 7838:38291 / 7838:38296 の見本値。API 配線時に差し替える。 */
const PLACEHOLDER_STATS = {
  brews: "1,204",
  visitors: "248",
} as const;

/**
 * 時間帯の相対量 (Figma 7838:38303 ほか)。ScaleBar の filled 比率は
 * symbol 実測 240/360 = 0.667 を「多い」の基準として段階化している。
 */
const PLACEHOLDER_TIME_OF_DAY = [
  { id: "morning", value: 0.67, level: "high" },
  { id: "noon", value: 0.22, level: "low" },
  { id: "evening", value: 0.45, level: "mid" },
  { id: "night", value: 0.67, level: "high" },
] as const;

/** Figma NoteCard 6 枚 (7840:39599 ほか) の見本文。API 配線時に差し替える。 */
const PLACEHOLDER_NOTES: SignsNote[] = [
  { id: "n1", voice: "湯が沸くまでの三分が、いちばん静か。", tea: "焙じ茶 — 秋摘み", time: "21:04" },
  { id: "n2", voice: "二煎目でやっと肩の力が抜けた。", tea: "煎茶 — 八女", time: "20:47" },
  { id: "n3", voice: "濃く出しすぎた。次は湯冷ましをはさむ。", tea: "玉露 — 宇治", time: "20:31" },
  { id: "n4", voice: "雨の音といっしょに飲んでいる。", tea: "白茶 — 月光白", time: "19:58" },
  { id: "n5", voice: "今日は水出しにした。急がない日だから。", tea: "水出し煎茶 — 知覧", time: "19:22" },
  { id: "n6", voice: "朝いちばんの一杯だけは、誰にも渡さない。", tea: "煎茶 — 静岡", time: "07:12" },
];

export default async function SignsPage() {
  const t = await getTranslations("signs");

  return (
    <>
      {/* PageTitle 7838:38285 */}
      <Section spacing="none" className="flex flex-col gap-5 pt-14 pb-8 lg:pt-24">
        <h1 className="text-foreground">{t("title")}</h1>
        <p className={cn(bodySmClass, "max-w-160 text-muted-foreground")}>{t("lead")}</p>
      </Section>

      {/* Main 7838:38288 — 4col 集計 | 8col 一言 */}
      <Section
        spacing="none"
        className="grid grid-cols-4 gap-8 pt-10 pb-16 md:grid-cols-8 lg:grid-cols-12 lg:pt-12 lg:pb-24"
      >
        {/* 今週の集計 7838:38289 */}
        <div className="col-span-4 flex flex-col gap-10 md:col-span-8 lg:col-span-4">
          <h2 data-slot="section-title" className="text-foreground">{t("stats.heading")}</h2>

          {/* Stat 2 枚。SP 7839:492 は 2 カラム横並び (子 x0 / x187.5・各 w155.5 =
              内容幅 343 を gap 32 で二等分)、PC 7838:38289 は縦積み gap 40。
              lg で 1 カラムに戻し gap-10 にすると親 flex と同じ 40px リズムになる。 */}
          <div className="grid grid-cols-2 items-start gap-8 lg:grid-cols-1 lg:gap-10">
            <Stat value={PLACEHOLDER_STATS.brews} unit={t("stats.brewsUnit")} label={t("stats.brewsLabel")} />
            <Stat
              value={PLACEHOLDER_STATS.visitors}
              unit={t("stats.visitorsUnit")}
              label={t("stats.visitorsLabel")}
            />
          </div>

          {/* 時間帯 7838:38301 */}
          <div className="flex flex-col gap-5">
            <p className={cn(h4Class, "text-foreground")}>{t("timeOfDay.heading")}</p>
            {PLACEHOLDER_TIME_OF_DAY.map((row) => (
              <div key={row.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between">
                  <p className={cn(bodySmClass, "text-foreground")}>
                    {t(`timeOfDay.${row.id}` as "timeOfDay.morning")}
                  </p>
                  <p className={cn(captionClass, "text-muted-foreground")}>
                    {t(`timeOfDay.level.${row.level}` as "timeOfDay.level.high")}
                  </p>
                </div>
                <ScaleBar
                  value={row.value}
                  label={`${t(`timeOfDay.${row.id}` as "timeOfDay.morning")} — ${t("timeOfDay.barLabel")}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* みんなの一言 7838:38331 */}
        <div className="col-span-4 flex flex-col gap-4 md:col-span-8">
          <div className="flex flex-col items-baseline gap-2 sm:flex-row sm:justify-between sm:gap-4">
            <h2 data-slot="section-title" className="text-foreground">{t("notes.heading")}</h2>
            <p className={cn(bodySmClass, "text-muted-foreground")}>{t("notes.noReply")}</p>
          </div>
          <NoteFeed
            notes={PLACEHOLDER_NOTES}
            labels={{
              wakaru: t("reactions.wakaru"),
              iina: t("reactions.iina"),
              kininaru: t("reactions.kininaru"),
            }}
          />
        </div>
      </Section>

      {/* この場所の決まりごと 7838:38407 */}
      <Section spacing="none" className="flex flex-col gap-6 py-10 lg:py-24">
        <h2 data-slot="section-title" className="text-foreground">{t("rules.heading")}</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          {(["anonymous", "noReply", "threeOnly"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <p className={cn(h4Class, "text-foreground")}>{t(`rules.${key}.title`)}</p>
              <p className={cn(bodySmClass, "text-muted-foreground")}>{t(`rules.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* hairline 7838:38419 — 全幅 1px */}
      <hr className="w-full border-t border-border" />

      {/* 茶葉導線 7838:38420 — このページ唯一の買い物導線 */}
      <Container className="py-10 lg:py-16">
        <div className="flex flex-col gap-3">
          <Link
            href="/products"
            className={cn(bodySmClass, "w-fit text-foreground underline underline-offset-4")}
          >
            {t("shopLink")}
          </Link>
          <p className={cn(captionClass, "text-muted-foreground")}>{t("shopNote")}</p>
        </div>
      </Container>
    </>
  );
}

/**
 * Stat — 数値 (display 44px) + 単位 (h4 16px) + ラベル (caption 12px)。
 * Figma 7838:38291 / 7838:38296。数値は等幅で桁が揺れないようにする。
 */
function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2 text-foreground">
        <span className="[font:var(--typography-style-display)] tabular-nums">{value}</span>
        <span className={cn(h4Class)}>{unit}</span>
      </p>
      <p className={cn(captionClass, "text-muted-foreground")}>{label}</p>
    </div>
  );
}
