import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: t("tokushoho"),
  };
}

export default async function TokushohoPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <div className="flex flex-col gap-12 md:gap-16">
        {/* Top: breadcrumb + title (変A Reading Column / Top) */}
        <div className="flex flex-col gap-5 md:gap-6">
          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
              { label: t("tokushoho") },
            ]}
          />
          <h1>{t("tokushoho")}</h1>
        </div>

        {/* Rows (変A Reading Column / Definition rows) */}
        <dl className="flex flex-col">
          <Row label="販売業者" value="株式会社elxea" />
          <Row label="代表者" value="[代表者名]" />
          <Row label="所在地" value="[所在地住所]" />
          <Row label="電話番号" value="[電話番号]" />
          <Row label="メールアドレス" value="support@elxea.com" />
          <Row label="URL" value="https://elxea.com" />
          <Row label="販売価格" value="各商品ページに記載（税込表示）" />
          <Row
            label="商品代金以外の必要料金"
            value="送料：全国一律550円（税込）。5,000円以上のご注文で送料無料。定期便は送料無料。"
          />
          <Row
            label="支払方法"
            value="クレジットカード（Visa、Mastercard、American Express、JCB）、Apple Pay、Google Pay、Shop Pay"
          />
          <Row
            label="支払時期"
            value="クレジットカード：ご注文時に決済。定期便：各配送サイクルの決済日に自動決済。"
          />
          <Row
            label="商品の引渡時期"
            value="ご注文確定後、通常3〜5営業日以内に発送。定期便は毎月所定の発送日にお届け。"
          />
          <Row
            label="返品・交換"
            value="食品のため、お客様都合での返品はお受けしておりません。商品に不備があった場合は、到着後7日以内にご連絡ください。交換または返金にて対応いたします。"
          />
          <Row
            label="定期便の解約"
            value="マイページよりいつでも解約可能です。次回発送日の3日前までにお手続きください。"
          />
        </dl>

        {/* Meta (変A Reading Column / Meta) */}
        <div className="flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>
            ※ [代表者名]、[所在地住所]、[電話番号] は本番公開前に実際の情報に差し替えてください。
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-4 md:flex-row md:gap-6 md:py-5">
      <dt className="text-sm text-muted-foreground md:w-44 md:shrink-0">
        {label}
      </dt>
      <dd className="text-base leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}
