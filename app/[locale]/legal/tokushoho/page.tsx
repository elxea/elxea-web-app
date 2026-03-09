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
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("tokushoho") },
        ]}
      />
      <h1 className="mb-12">{t("tokushoho")}</h1>

      <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
        <table className="w-full border-collapse">
          <tbody className="divide-y divide-border">
            <Row label="販売業者" value="株式会社elxea" />
            <Row label="代表者" value="[代表者名]" />
            <Row label="所在地" value="[所在地住所]" />
            <Row label="電話番号" value="[電話番号]" />
            <Row label="メールアドレス" value="support@elxea.com" />
            <Row label="URL" value="https://elxea.com" />
            <Row
              label="販売価格"
              value="各商品ページに記載（税込表示）"
            />
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
          </tbody>
        </table>

        <p className="text-xs text-muted-foreground">
          ※ [代表者名]、[所在地住所]、[電話番号] は本番公開前に実際の情報に差し替えてください。
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-4 pr-6 text-foreground font-medium whitespace-nowrap align-top w-40">
        {label}
      </td>
      <td className="py-4">{value}</td>
    </tr>
  );
}
