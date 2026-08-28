"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { Columns } from "./container";
import { Logo } from "./logo";
import { CookieSettingsButton } from "./cookie-settings-button";
import { Separator } from "@/components/ui/separator";

type FooterNavItem = { href: string; label: string };
type FooterGroup = { label: string; items: FooterNavItem[] };
type FooterProps = { groups?: FooterGroup[] };

export function Footer({ groups: externalGroups }: FooterProps) {
  const t = useTranslations();

  const useExternalGroups = externalGroups && externalGroups.length > 0;

  return (
    // The bottom padding is structural, not decoration. Something is almost
    // always fixed to the bottom of this viewport — the chat launcher, the
    // cookie banner, a toast — and `.section-wide`'s 64px alone is less than
    // any of them, so the last row (the legal links) ends up underneath.
    // Reserving the space here solves it once for every bottom-fixed element
    // instead of teaching each one to dodge the footer.
    <footer className="border-t border-border mt-auto bg-background pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      <div className="section-wide">
        {/* Figma Footer / Columns 5663:49 = 292px 列 x4 + 48px gap x3 = 1312。
            旧実装は md:grid-cols-5 で 5 トラック中 4 つしか埋まらず、実測列幅が
            292px ではなく 224px になっていた。 */}
        <Columns count={4} gap="lg">
          {/* Brand — always rendered */}
          <div>
            <Logo size="md" className="mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("home.tagline")}
            </p>
          </div>

          {useExternalGroups ? (
            /* Dynamic groups from Sanity */
            externalGroups!
              .filter((group) => group.label !== "Legal")
              .map((group) => (
                <div key={group.label}>
                  <p className="text-sm font-medium mb-5">{group.label}</p>
                  <ul className="space-y-3">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          ) : (
            /* Hardcoded fallback columns */
            <>
              {/* Shop */}
              <div>
                <p className="text-sm font-medium mb-5">{t("footer.shop")}</p>
                <ul className="space-y-3">
                  <li>
                    <Link
                      href="/products"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.products")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/collections"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.collections")}
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Content */}
              <div>
                <p className="text-sm font-medium mb-5">{t("footer.content")}</p>
                <ul className="space-y-3">
                  <li>
                    <Link
                      href="/journal"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.journal")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/tea-menu"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.teaMenu")}
                    </Link>
                  </li>
                  {/* 茶葉診断 (/diagnosis) — CDP 統合 Stage 4 で開いた Web 入口。
                      いまはここがサイト内で唯一の導線。トップページの Figma 節
                      8110:2514 は忠実度ゲート (数値対比表 + 別エージェント監査) の
                      対象なので別タスクに残してある (app/[locale]/diagnosis/page.tsx)。 */}
                  <li>
                    <Link
                      href="/diagnosis"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("diagnosis.title")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/playlists"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.playlists")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/elxea-journal"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      elxea Journal
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/events"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.events")}
                    </Link>
                  </li>
                  {/* みんなの気配 (/signs) — サイト内で唯一の入口。
                      「買う」導線ではなく「今週この場所で何が起きたかを眺める」面
                      なので、ヘッダーの主要ナビ (商品一覧 / 定期便 / ジャーナル /
                      お茶メニュー / プレイリスト / イベント = いずれも複数件を
                      たどる一覧) には並べず、読みもの系をまとめたこの
                      「コンテンツ」列の末尾に置く。ラベルはページ側の見出しと
                      同じ `signs.title` を引き、名前がずれないようにする。
                      この行が消えると /signs は再びサイト内から到達不能になるため、
                      `__tests__/route-reachability.test.ts` が回帰を赤で止める。 */}
                  <li>
                    <Link
                      href="/signs"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("signs.title")}
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Support */}
              <div>
                <p className="text-sm font-medium mb-5">{t("footer.support")}</p>
                <ul className="space-y-3">
                  <li>
                    <Link
                      href="/about"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.about")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/faq"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.faq")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/contact"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.contact")}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/shipping"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("common.shipping")}
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Language — hidden until English content is ready
              <div>
                <p className="text-sm font-medium mb-5">{t("common.language")}</p>
                <LanguageSwitcher />
              </div>
              */}
            </>
          )}
        </Columns>

        {/* Legal links + Copyright */}
        <Separator className="mt-12" />
        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {useExternalGroups ? (
              (externalGroups!.find((g) => g.label === "Legal")?.items ?? []).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ))
            ) : (
              <>
                <Link
                  href="/legal/tokushoho"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("legal.tokushoho")}
                </Link>
                <Link
                  href="/legal/privacy"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("legal.privacy")}
                </Link>
                <Link
                  href="/legal/terms"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("legal.terms")}
                </Link>
                <Link
                  href="/legal/returns"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("legal.returns")}
                </Link>
              </>
            )}
            {/* Rendered for both branches: the cookie choice must stay
                changeable even when the Legal group comes from Sanity. */}
            <CookieSettingsButton />
          </nav>
          <p className="text-xs text-muted-foreground">
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
