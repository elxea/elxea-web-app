import { getLocale, getTranslations } from "next-intl/server";

export async function MemberGate() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  return (
    <div className="mt-8 py-12 text-center border-t border-border">
      <p className="text-[13px] text-light uppercase tracking-wider mb-3">
        {tCommon("memberOnly")}
      </p>
      <p className="text-muted text-[14px] mb-8 max-w-md mx-auto">
        {t("memberOnlyDescription")}
      </p>
      <a
        href={`/api/auth/login?locale=${locale}`}
        className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
      >
        {tCommon("login")}
      </a>
    </div>
  );
}
