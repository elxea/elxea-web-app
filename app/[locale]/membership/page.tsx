import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getMembershipTier } from "@/lib/shopify/auth";
import type { MembershipTier } from "@/lib/shopify/customer";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("membership");
  return {
    title: t("title"),
    description: t("description"),
  };
}

type PlanFeature = {
  key: string;
  tiers: MembershipTier[];
};

const PLAN_FEATURES: PlanFeature[] = [
  { key: "featureBrowse", tiers: ["none", "standard", "premium"] },
  { key: "featureJournal", tiers: ["none", "standard", "premium"] },
  { key: "featureMemberContent", tiers: ["standard", "premium"] },
  { key: "featureMemberEvents", tiers: ["standard", "premium"] },
  { key: "featurePremiumContent", tiers: ["premium"] },
  { key: "featurePriorityEvents", tiers: ["premium"] },
  { key: "featureSpecialOffers", tiers: ["premium"] },
];

const TIERS: MembershipTier[] = ["none", "standard", "premium"];

export default async function MembershipPage() {
  const t = await getTranslations("membership");
  const currentTier = await getMembershipTier();

  const tierConfig: Record<
    MembershipTier,
    { name: string; description: string; actionable: boolean }
  > = {
    none: {
      name: t("free"),
      description: t("freeDescription"),
      actionable: false,
    },
    standard: {
      name: t("standard"),
      description: t("standardDescription"),
      actionable: true,
    },
    premium: {
      name: t("premium"),
      description: t("premiumDescription"),
      actionable: true,
    },
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Plans
        </p>
        <h1 className="mb-6">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">{t("description")}</p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {TIERS.map((tier) => {
          const config = tierConfig[tier];
          const isCurrent = tier === currentTier;

          return (
            <div
              key={tier}
              className={`rounded-xl p-6 flex flex-col gap-5 bg-card ${
                isCurrent
                  ? "border-2 border-foreground"
                  : "border border-border"
              }`}
            >
              {/* Header */}
              <div className="flex flex-col gap-2">
                {isCurrent && (
                  <span className="inline-flex w-fit rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-xs font-medium">
                    {t("currentPlan")}
                  </span>
                )}
                <h2 className="text-xl font-medium">{config.name}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {config.description}
                </p>
              </div>

              {/* Perks */}
              <ul className="flex-1 flex flex-col gap-3">
                {PLAN_FEATURES.map((feature) => {
                  const included = feature.tiers.includes(tier);
                  return (
                    <li
                      key={feature.key}
                      className={`text-sm flex items-start gap-2 ${
                        included ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <span className="shrink-0 font-medium">
                        {included ? "＋" : "－"}
                      </span>
                      <span className="flex-1">{t(feature.key)}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Action */}
              {isCurrent ? (
                <div className="flex justify-center px-4 py-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("currentPlan")}
                  </span>
                </div>
              ) : config.actionable ? (
                <Button variant="secondary" className="w-full rounded-lg" asChild>
                  <Link href="/contact">{t("comingSoon")}</Link>
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        {t("contactUs")}
      </p>
    </div>
  );
}
