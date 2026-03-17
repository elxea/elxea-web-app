import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "シングルオリジンティーの定期便",
  description:
    "旅をするように味わう、厳選されたシングルオリジンティーの定期便。",
};

export default function SubscriptionLPPage() {
  return (
    <>
      {/* ─── 1. Hero ─── */}
      <section className="relative min-h-[80vh] flex items-center justify-center">
        <div className="absolute inset-0 bg-muted" />
        {/* TODO: hero image */}
        <div className="relative text-center max-w-xl px-6">
          <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-6">
            旅をするように味わう、
            <br />
            厳選されたシングルオリジンティーの定期便。
          </h1>
          <Button asChild>
            <a href="#">お茶の定期便をはじめてみる</a>
          </Button>
        </div>
      </section>

      {/* ─── 2. ブランド紹介 ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="mb-6">
          elxea（エルクシア）は上質なお茶をお届けする、シングルオリジンティーのブランドです。
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-10">
          elxeaはお茶のもつ多様性とロマンに魅せられ、世界を巡り探し出したこだわりの茶葉を厳選。産地ごとのテロワールを楽しんでいただける、上質なシングルオリジンティーのセレクションがあなたのティータイムを特別な時間に彩ります。
        </p>

        {/* 画像グリッド（プレースホルダー） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square bg-muted" />
          ))}
        </div>
      </section>

      {/* ─── 3. シングルオリジンの魅力 ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="mb-6">
          ふだんのお茶とは一味違う、シングルオリジンティーの魅力。
        </h2>

        {/* 画像プレースホルダー */}
        <div className="relative aspect-[16/9] w-full bg-muted mb-8" />

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>
            シングルオリジンとは直訳すると「単一産地」という意味で、農場、生産者、品種や精製方法ごとに細かく分けて各銘柄とするメニューの考え方です。
          </p>
          <p>
            一般的に流通しているお茶のように、産地を「生産国」といったかたちで大きく区分け、各産地の茶葉をブレンドすることで安定的で大ロットな供給を可能とする大量生産型の考え方とは異なり、シングルオリジンティーは比較的小規模な茶農家さんにつくられることもあり、多くを生産することはできません。それゆえに、シングルオリジンティーには際立った個性を楽しめる醍醐味があります。
          </p>
          <p>
            それはワインの世界でいう「テロワール」のように、各お茶の品種、それらが育まれる土壌や気候といったさまざな自然の恵みによる特徴に加え、その土地に息づく人びとの文化や記憶が生み出すユニークさにあり、それはまさに一杯という旅を通じた「一期一会の出会い」といえるでしょう。
          </p>
        </div>
      </section>

      {/* ─── 4. 商品ラインナップ（プレースホルダー） ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">
          全国各地より厳選された40種類以上のシングルオリジン茶葉による充実のラインナップ。
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {[
            "N°01 香駿",
            "N°03 べにふうき",
            "N°02 べにふうき",
            "やぶきたの手摘み煎茶",
            "香駿の和紅茶",
            "静七一三二の萎凋煎茶",
            "ふくみどりの萎凋釜炒り緑茶入り",
            "べにふうきの和紅茶",
            "みなみさやかの和烏龍茶",
            "香駿の和烏龍茶",
            "大井早生の手摘み煎茶",
            "香駿の萎凋釜炒り緑茶",
            "いずみの和紅茶",
            "みなみさやかの萎凋釜炒り緑茶",
          ].map((name) => (
            <div key={name}>
              <div className="aspect-square bg-muted mb-4" />
              <p className="text-xs text-muted-foreground mb-1">Single</p>
              <p className="text-sm">{name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 5. 定期便プラン詳細 ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">
          美味しいお茶とともに広がる楽しみ、定期便でお届けします。
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* 画像プレースホルダー */}
          <div className="aspect-[4/3] bg-muted" />

          <Card>
            <CardHeader>
              <CardTitle>シングルオリジンティーの定期便</CardTitle>
              <CardDescription>初回特別価格</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <span className="text-3xl font-light">¥1,480</span>
                <span className="text-sm text-muted-foreground ml-2">
                  (税込)
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  + 送料無料
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                ※2回目以降は各回2,280円(送料無料)でお届けいたします。
              </p>

              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  厳選された40種類以上のシングルオリジンティーによる充実のラインナップ。
                </li>
                <li>
                  楽しみながらお茶について詳しく学べる、オンラインジャーナルを隔月でお届けします。
                </li>
                <li>
                  お好みの消費ペースに合わせて、茶葉の配送頻度を変更いただけます。
                </li>
              </ul>

              <Button className="w-full" asChild>
                <a href="#">お茶の定期便をはじめてみる</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── 6. ティーバッグ素材 ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">
          茶器を持っていなくても大丈夫。本格的なクラフトティーをいつでも手軽にお楽しみいただけます。
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="aspect-[4/3] bg-muted mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              自然環境や身体への負担を考慮し、ティーバッグの素材に植物（トウモロコシ）のデンプンを原料にした繊維新素材、ソイロンを使用しています。
            </p>
          </div>
          <div>
            <div className="aspect-[4/3] bg-muted mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              自然環境や身体への負担を考慮し、ティーバッグの素材に植物（トウモロコシ）のデンプンを原料にした繊維新素材、ソイロンを使用しています。
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              ※ソイロンは植物由来の素材により、廃棄後は完全分解され土に還る地球環境にやさしい素材です。
            </p>
          </div>
        </div>
      </section>

      {/* ─── 7. 3つの特徴 ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            number="01"
            title="厳選された40種類以上のシングルオリジンティーによる充実のラインナップ。"
            description="全国各地より厳選された40種類以上のシングルオリジン茶葉より、あなたのお好みに合わせてお届けします。緑茶、烏龍茶、紅茶の3種のカテゴリーより、お好みの茶葉をお選び頂けます。"
            note="※入荷時期によって、お選び頂けるお茶のカテゴリーが限られることもございます。"
          />
          <FeatureCard
            number="02"
            title="楽しみながらお茶について詳しく学べる、オンラインジャーナルを隔月でお届けします。"
            description="茶農家さんごとの製茶のプロセスやこだわりをはじめ、様々な産地や品種やごとの特徴など、知ることでより深く、美味しくお茶を楽しめるオンラインジャーナルを隔月でお届けします。"
            note="※オンラインジャーナルの内容は変更になる場合もございます。"
          />
          <FeatureCard
            number="03"
            title="お好みの消費ペースに合わせて、茶葉の配送頻度をいつでも変更いただけます。"
            description="定期便プランをご利用中、ご利用されない月はスキップするなど、茶葉の配送頻度をいつでもご変更いただけます。"
          />
        </div>
      </section>

      {/* ─── 8. 定期便限定特典 ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">
          さらに、定期便をご利用の方だけのお得な特典
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <Card>
            <CardHeader>
              <div className="aspect-[3/2] bg-muted -mx-6 -mt-6 rounded-t-xl" />
            </CardHeader>
            <CardContent className="space-y-3">
              <CardTitle>スペシャルイベントへご招待します。</CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                世界の喫茶文化、こころと身体の健康、茶摘み体験、旬の食材によるお料理とのフードペアリングなど、様々なテーマによるイベントへ会員価格でご参加頂けます。美味しいお茶に集う多様な人々に焦点を当て、多才なゲストをお迎えするイベントにご参加頂けます。
              </p>
              <p className="text-xs text-muted-foreground">
                ※開催イベントのテーマは予告となり、変更になる場合もございます。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="aspect-[3/2] bg-muted -mx-6 -mt-6 rounded-t-xl" />
            </CardHeader>
            <CardContent className="space-y-3">
              <CardTitle>
                お気に入りのメニューは特別価格で、いつでもお得に購入できます。
              </CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                お気に入りのメニューは個包装や徳入りパックなどの単品商品を、10%OFFの特別価格にてお買い求めて頂けます。
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>※ 本プランは定期購入プランになります</p>
          <p>
            ※初回購入の方に限り、お選び頂いたお茶のセットを特別料金の1,880円(税込)
            でお届けします。
          </p>
          <p>※ 送料は本プランにおいては一律無料となります。</p>
          <p>
            ※
            2回目以降は初回にお選びいただいたセットからお好きなカテゴリーのお茶に変更いただけます。変更のない場合は、季節に合わせたおすすめのメニューをお送りいたします。
          </p>
          <p>
            ※ 定期便の配送スキップや解約に伴う違約金は一切ございません。
          </p>
        </div>
      </section>

      {/* ─── 9. CTA ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="mb-8">お茶のある暮らしをはじめよう。</h2>
        <Button asChild>
          <a href="#">お茶の定期便をはじめてみる</a>
        </Button>
      </section>

      {/* ─── 10. FAQ ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="mb-10">よくあるご質問について</h2>

        <div className="divide-y divide-border">
          {[
            {
              q: "お届けストップ（解約）はできますか？",
              a: "はい、いつでも解約いただけます。違約金は一切ございません。",
            },
            {
              q: "注文後、どれくらいで届きますか？",
              a: "ご注文後、通常3〜5営業日以内に発送いたします。",
            },
            {
              q: "どのような方法で配送されますか？配送方法は選べますか？",
              a: "ヤマト運輸のネコポスまたは宅急便でお届けします。",
            },
            {
              q: "1回目の料金はいつ決済、課金されますか？",
              a: "ご注文確定時に決済が行われます。",
            },
            {
              q: "その後の決済はどのタイミングになりますか？",
              a: "初回お届け日から30日後に次回分の決済が行われます。",
            },
            {
              q: "決済方法は何がありますか？",
              a: "クレジットカード（Visa、Mastercard、JCB、American Express）、Apple Pay、Google Payに対応しています。",
            },
            {
              q: "届いた商品の返品／交換は可能でしょうか？",
              a: "商品の性質上、お客様都合での返品・交換はお受けしておりません。万が一不良品が届いた場合はお問い合わせください。",
            },
            {
              q: "定期便ではなく1回限りで購入できますか？",
              a: "はい、単品での購入も可能です。商品ページよりお買い求めください。",
            },
            {
              q: "定期便で届くお茶の賞味期限はどのくらいですか？",
              a: "製造日より約1年間となります。",
            },
            {
              q: "定期便の内容だけですぐお茶が飲めますか？何か必要なものはありますか？",
              a: "ティーバッグでお届けしますので、カップとお湯があればすぐにお楽しみいただけます。",
            },
          ].map((item, i) => (
            <details key={i} className="group py-6">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <span className="text-sm text-foreground font-medium pr-4">
                  {item.q}
                </span>
                <span className="text-muted-foreground text-lg shrink-0 group-open:rotate-45 transition-transform">
                  +
                </span>
              </summary>
              <p className="text-sm text-muted-foreground leading-relaxed mt-4 pr-8">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ─── 11. 最終 CTA ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="mb-8">お茶のある暮らしをはじめよう。</h2>
        <Button asChild>
          <a href="#">お茶の定期便をはじめてみる</a>
        </Button>
      </section>
    </>
  );
}

function FeatureCard({
  number,
  title,
  description,
  note,
}: {
  number: string;
  title: string;
  description: string;
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        {/* イラストプレースホルダー */}
        <div className="aspect-square bg-muted -mx-6 -mt-6 rounded-t-xl" />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{number}</p>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
