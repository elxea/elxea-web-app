import { Button } from "@/components/ui/button";

import { AccountPanelSection } from "@/components/account/account-panel";
import {
  formatLinkedDate,
  isLinkedForDisplay,
  type LineLinkageStatus,
} from "@/lib/line/linkage-status";

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
    linkedHeading: "LINEと連携済み",
    /** 連携日が分かるとき。`{date}` を実際の日付に差し替える。 */
    linkedWithDate:
      "{date} から LINE と連携しています。あなたの好みに合わせたご案内を LINE のトークでお届けしています。",
    /** 連携済みだが日付が取れないとき。日付を言い切らない。 */
    linkedNoDate:
      "LINE と連携しています。あなたの好みに合わせたご案内を LINE のトークでお届けしています。",
  },
  en: {
    heading: "Link with LINE",
    description:
      "Connect your LINE with this account to receive suggestions tailored to your taste right in the LINE chat. You can also check your orders and subscription from the chat.",
    button: "Link with LINE",
    linkedHeading: "Linked with LINE",
    linkedWithDate:
      "Linked with LINE since {date}. We send suggestions tailored to your taste in the LINE chat.",
    linkedNoDate:
      "Linked with LINE. We send suggestions tailored to your taste in the LINE chat.",
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

/**
 * @param status 連携状態（P1）。`linked` は 3 値。
 *   - `true`  … 連携済み。日付を出し、連携ボタンは出さない
 *   - `false` … 未連携。従来どおり連携ボタンを出す
 *   - `null`  … 不明（記録簿が読めなかった）。**未連携と同じ表示**にする
 *
 *   不明を未連携と同じ見た目にするのは、押しても連携済みなら冪等に済む（二度押しで
 *   壊れない upsert）ため、「読めないので何も出さない」より安全側だから。逆に
 *   「連携済み」と言い切ってしまうと、実際は未連携の人が連携導線を失う。
 *
 *   ⚠ 連携済みでも**解除の導線は出さない**。解除が行削除か旗立てかという状態遷移が
 *   まだ確定しておらず（P1b で決める）、押せる解除ボタンを先に置くと定義が実装に
 *   引きずられる。ここに解除ボタンを足す前に、必ずその判断を先に済ませること。
 */
export function LineLinkageEntry({
  locale,
  status,
}: {
  locale: string;
  status?: LineLinkageStatus;
}) {
  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];

  // 連携済み: 状態を伝えるだけ。LIFF 未設定でもこの表示は出す（既に繋がっている
  // 事実は設定の有無と関係ないため。連携導線だけが env に依存する）。
  if (isLinkedForDisplay(status)) {
    const date = formatLinkedDate(status.linkedAt, locale);
    return (
      <AccountPanelSection title={t.linkedHeading} testId="line-linkage-entry">
        <p
          className="text-sm text-muted-foreground leading-relaxed"
          data-testid="line-linkage-linked"
        >
          {date ? t.linkedWithDate.replace("{date}", date) : t.linkedNoDate}
        </p>
      </AccountPanelSection>
    );
  }

  // 未連携 / 不明: 従来どおり連携導線を出す。
  const url = liffLinkageUrl();
  if (!url) return null; // 設定未了（prod 未カットオーバー等）は静かに非表示

  return (
    <AccountPanelSection title={t.heading} testId="line-linkage-entry">
      <div className="flex items-start justify-between gap-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t.description}
        </p>
        <Button variant="outline" size="sm" className="shrink-0" asChild>
          {/* LIFF permanent link。LINE アプリ内ブラウザ / ブラウザ内 LINE ログインで /liff/link を開く。 */}
          <a href={url} rel="noopener noreferrer" data-testid="line-linkage-cta">
            {t.button}
          </a>
        </Button>
      </div>
    </AccountPanelSection>
  );
}
