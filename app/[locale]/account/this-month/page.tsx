import type { Metadata } from "next";
import { after } from "next/server";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { ThisMonthBoard } from "@/components/profile/this-month-board";
import { Link } from "@/i18n/navigation";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import { jstDay, toFeedbackShownGatewayEvent } from "@/lib/cdp/cup-feedback";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import {
  getCupFeedbackMarks,
  getPendingRecipientOrder,
} from "@/lib/firebase/profile-store";
import { logger } from "@/lib/log";
import { pickAskableCups, pickIssues, type IssueForCups } from "@/lib/roji/issue-cups";
import { sanityFetch } from "@/sanity/lib/fetch";
import { ISSUE_CUPS_QUERY } from "@/sanity/lib/queries";

/**
 * 今月のお茶 /ja/account/this-month — 顧客プロファイル 第1段 ① / ⑤ / ⑦。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 / §2「『届いた後の2択』は
 * どうやって届くか」/ §7 択一 #4・#11。
 *
 * ## この画面は何なのか
 *
 * 同梱の QR カード（**全員同一**・URL に個人を指すものは載らない）から着地する面。
 * カードは入口だけを担い、**問いはこのページが出す**（設計「2択はカードの機能では
 * なく、ページの機能」）。到達 3 経路のうち 2 本（カード / 次に開いたとき）が
 * ここに集まる。3 本目（会話の中）は cx-agent 側。
 *
 * ## ログインが要る（択一 #11 = (a)）
 *
 * URL に個人番号を出さないと決まっているので、本人はログインでしか決まらない。
 * 未ログインは middleware が `/login` へ送る（`middleware.ts` の /account ガード）。
 * ここに二重の判定を置いているのは、middleware を通らない経路（直接の RSC 呼び出し）
 * でも本人以外に問いを出さないため。
 *
 * ## 「送った記録」の正本はここではない（限界の明示）
 *
 * どの号の何を誰に送ったかの台帳（設計 §6 ⓪）は cx-agent 側にあり、web-app から
 * 引く口がまだ無い。この画面は **号に入っているお茶** を「届いた一杯」と見なす
 * （理由と割り切りは `lib/roji/issue-cups.ts` の doc）。台帳の口ができたら
 * `pickAskableCups` の入力を差し替える。
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("thisMonth");
  return { title: t("title"), description: t("subtitle") };
}

/** Sanity から返る 1 号ぶん（`ISSUE_CUPS_QUERY` の形）。 */
type IssueRow = {
  _createdAt?: string;
  title?: string;
  slug?: { current?: string };
  featured?: boolean;
  teaMenus?: {
    title?: string;
    displayName?: string;
    productNumber?: string | number;
    slug?: { current?: string };
  }[];
};

function toIssues(rows: IssueRow[]): IssueForCups[] {
  return rows
    .filter((row) => typeof row.slug?.current === "string" && typeof row.title === "string")
    .map((row) => ({
      slug: row.slug!.current!,
      title: row.title!,
      featured: row.featured ?? false,
      createdAt: row._createdAt ?? null,
      teas: (row.teaMenus ?? []).map((tea) => ({
        productNumber: tea.productNumber ?? null,
        title: tea.title ?? "",
        displayName: tea.displayName ?? null,
        slug: tea.slug?.current ?? null,
      })),
    }));
}

export default async function ThisMonthPage() {
  const t = await getTranslations("thisMonth");
  const locale = await getLocale();
  const auth = await resolveIdentity();

  if (!auth.authenticated) {
    /* middleware が先に送るので通常は来ない。来たときに白紙を出さない。 */
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

  /* 号・印・注文は互いに依存しないので同時に取る（ウォーターフォールを作らない）。 */
  const [issueRows, marks, recipientOrder] = await Promise.all([
    sanityFetch<IssueRow[]>({
      query: ISSUE_CUPS_QUERY,
      params: { language: locale },
      cache: { tag: "sanity:journals" },
    }).catch((err: unknown) => {
      /* 号が読めないと問いが 1 つも出せない。画面は出すが、原因は残す。 */
      logger.error("account.this-month.issues-unreadable", err, { locale });
      return [] as IssueRow[];
    }),
    getCupFeedbackMarks(auth.userKey).catch((err: unknown) => {
      /* 読めないときは「まだ聞いていない」に倒す（もう一度聞くだけで済む）。 */
      logger.error("account.this-month.marks-unreadable", err, {});
      return {};
    }),
    getPendingRecipientOrder(auth.userKey).catch((err: unknown) => {
      logger.error("account.this-month.orders-unreadable", err, {});
      return null;
    }),
  ]);

  const issues = pickIssues(toIssues(issueRows ?? []));
  const cups = pickAskableCups(issues, new Set(Object.keys(marks)));

  /* ⑦ 回答率の分母。**画面を出したこと**を 1 人 × 1 号 × 1 日で 1 行だけ残す。
     応答をこれで遅らせない（`after` で描画のあとに回す）。 */
  if (cups.length > 0 && issues.current) {
    const currentIssueRef = issues.current.slug;
    const productNos = cups.map((cup) => cup.productNo);
    const consentCookie = (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null;
    after(async () => {
      const subject = resolveBehaviorSubject(auth, undefined, consentCookie);
      if (subject.kind === null) return;
      const now = new Date();
      await sendToEventsGateway([
        toFeedbackShownGatewayEvent(
          subject,
          { issueRef: currentIssueRef, productNos, day: jstDay(now) },
          now.toISOString(),
        ),
      ]);
    });
  }

  return (
    <div className="section-narrow">
      <header className="mb-10 md:mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-2xl font-normal">{t("title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
      </header>

      <ThisMonthBoard
        cups={cups}
        recipientOrder={
          recipientOrder
            ? { orderId: recipientOrder.orderId, orderNumber: recipientOrder.orderNumber }
            : null
        }
      />

      <footer className="mt-14 space-y-3 border-t border-border pt-8 text-xs leading-relaxed text-muted-foreground">
        <p>
          {t("impressionsLead")}{" "}
          <Link href="/contact" className="underline">
            {t("impressionsLink")}
          </Link>
        </p>
        <p>
          {t("safetyLead")}{" "}
          <Link href="/account/safety" className="underline">
            {t("safetyLink")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
