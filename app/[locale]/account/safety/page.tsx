import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SafetyForm } from "@/components/profile/safety-form";
import { Link } from "@/i18n/navigation";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { getSafetyDeclaration } from "@/lib/firebase/profile-store";
import { logger } from "@/lib/log";

/**
 * 避けたいもの /ja/account/safety — 顧客プロファイル 第1段 ⑥。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ⑥
 * （「受け口は実装済み、画面だけ無い」）/ §2 の判定列「妊娠は病歴に当たらないが、
 * 要配慮相当として扱う（明示同意・厳格管理）」/ §4「どのオフを選んでも、安全申告は
 * 絶対に効き続ける」。
 *
 * ## この画面が守る線
 *
 * 受けるのは閉じた 3 区分だけで、病名・服薬・通院は聞かない（§2 の禁止表）。
 * 自由記入を置かない理由は `components/profile/safety-form.tsx` の doc にある
 * （読む人がいない欄になること / 要配慮情報が書かれうること）。
 *
 * ## 効能を語らない
 *
 * §2 の禁止表は「効能を語る — AI の発言でも、**画面の文言でも**」を明示的に
 * 禁じている。この画面の文言は「届くお茶からその区分を外す」という**手続き**
 * だけを述べ、体調への作用には一切触れない（i18n の文言もそう書いてある）。
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("safety");
  return { title: t("title"), description: t("subtitle") };
}

export default async function SafetyPage() {
  const t = await getTranslations("safety");
  const auth = await resolveIdentity();

  if (!auth.authenticated) {
    return (
      <div className="section-narrow">
        <h1 className="text-2xl font-normal">{t("title")}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t("loginRequired")}</p>
        <p className="mt-6 text-sm">
          <Link href="/login" className="underline">
            {t("loginLink")}
          </Link>
        </p>
      </div>
    );
  }

  const declaration = await getSafetyDeclaration(auth.userKey).catch((err: unknown) => {
    /* 申告済みが読めないまま「未申告」として描くと、同じ内容をもう一度書かせる。
       画面は出すが、読めなかったことは残す。 */
    logger.error("account.safety.declaration-unreadable", err, {});
    return { tags: [], updatedAt: null };
  });

  return (
    <div className="section-narrow">
      <header className="mb-10 md:mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-normal">{t("title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
      </header>

      <SafetyForm declared={declaration.tags} />
    </div>
  );
}
