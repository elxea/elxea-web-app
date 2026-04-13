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
    <div className="section-narrow py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Plans
        </p>
        <h1 className="mb-6">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">{t("description")}</p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        {TIERS.map((tier) => {
          const config = tierConfig[tier];
          const isCurrent = tier === currentTier;

          return (
            <div
              key={tier}
              className={`border p-6 flex flex-col ${
                isCurrent
                  ? "border-foreground"
                  : "border-border"
              }`}
            >
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg">{config.name}</h2>
                  {isCurrent && (
                    <span className="text-xs text-muted-foreground border border-border px-2 py-0.5">
                      {t("currentPlan")}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {config.description}
                </p>
              </div>

              {/* Features */}
              <div className="flex-1 mb-6">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                  {t("features")}
                </p>
                <ul className="space-y-2">
                  {PLAN_FEATURES.map((feature) => {
                    const included = feature.tiers.includes(tier);
                    return (
                      <li
                        key={feature.key}
                        className={`text-sm flex items-start gap-2 ${
                          included ? "text-foreground" : "text-muted-foreground/40"
                        }`}
                      >
                        <span className="shrink-0 mt-0.5">
                          {included ? "+" : "-"}
                        </span>
                        {t(feature.key)}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Action */}
              <div>
                {isCurrent ? (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {t("currentPlan")}
                  </p>
                ) : config.actionable ? (
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/contact">{t("comingSoon")}</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t("contactUs")}
      </p>
    </div>
  );
}
