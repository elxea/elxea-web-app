import { Button } from "@/components/ui/button";

/**
 * Web 側の LINE 連携エントリ（案A 第2弾 / Phase 2）。
 *
 * Shopify（Customer Account）にログイン済みのユーザーが、web の account ページから
 * LINE 連携フローに入るための導線。LINE 側（リッチメニュー「定期便」/ キーワード →
 * emitLinkageButton → LIFF）と同じ LIFF ページ（/liff/link）を、同じ LIFF permanent link
 * 経由で開く。押すと LINE アプリ内ブラウザ（またはブラウザ内 LINE ログイン）で LIFF が起動し、
 * liff.getIDToken() → /api/user/line-link-liff（Shopify セッション認証必須）→ cx-agent
 * link-liff（customer_linkages upsert + カルテ carryover）へと繋がる。
 *
 * env 前提（staging のみ・prod は別ゲート S2）:
 *   NEXT_PUBLIC_LIFF_ID … LIFF アプリ ID（公開値・build 時にインライン）。
 *   未設定なら導線を出さない（graceful hide）。設定漏れの環境で壊れたリンクを見せない。
 *
 * 文言方針: 静かで丁寧・絵文字なし・押し売りなし（liff-link-client と同じ体験原則）。
 * このコンポーネント内に JA/EN を内包する（本機能の他ページと同じインライン COPY 方式）。
 */

const COPY = {
  ja: {
    heading: "LINEと連携する",
    description:
      "ご利用中の LINE とこのアカウントを結び付けると、あなたの好みに合わせたご案内を LINE のトークで受け取れるようになります。ご注文や定期便の状況も、そのままトークでご確認いただけます。",
    button: "LINEと連携する",
  },
  en: {
    heading: "Link with LINE",
    description:
      "Connect your LINE with this account to receive suggestions tailored to your taste right in the LINE chat. You can also check your orders and subscription from the chat.",
    button: "Link with LINE",
  },
} as const;

type Locale = keyof typeof COPY;

/**
 * LIFF permanent link を組み立てる。NEXT_PUBLIC_LIFF_ID が無ければ null（＝導線を出さない）。
 */
function liffLinkageUrl(): string | null {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}`;
}

export function LineLinkageEntry({ locale }: { locale: string }) {
  const url = liffLinkageUrl();
  if (!url) return null; // 設定未了（prod 未カットオーバー等）は静かに非表示

  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];

  return (
    <section className="mb-12" data-testid="line-linkage-entry">
      <h2 className="text-lg mb-6 pb-3 border-b border-border">{t.heading}</h2>
      <div className="flex items-start justify-between gap-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t.description}
        </p>
        <Button variant="outline" size="sm" className="shrink-0" asChild>
          {/* LIFF permanent link。LINE アプリ内ブラウザ / ブラウザ内 LINE ログインで /liff/link を開く。 */}
          <a href={url} rel="noopener noreferrer">
            {t.button}
          </a>
        </Button>
      </div>
    </section>
  );
}
