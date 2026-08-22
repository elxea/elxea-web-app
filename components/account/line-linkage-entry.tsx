import { AccountPanelSection } from "@/components/account/account-panel";
import { LineLinkageCta } from "@/components/account/line-linkage-cta";
import { LineUnlinkControl } from "@/components/account/line-unlink-control";
import {
  formatLinkedDate,
  isLinkedForDisplay,
  type LineLinkageStatus,
} from "@/lib/line/linkage-status";

/**
 * Web 側の LINE 連携エントリ（案A 第2弾 / Phase 2）。
 *
 * Shopify（Customer Account）にログイン済みのユーザーが、web の account ページから
 * LINE 連携フローに入るための導線。
 *
 * ## P2 で変わったこと（LIFF permanent link をやめた）
 *
 * ここは以前 `https://liff.line.me/{NEXT_PUBLIC_LIFF_ID}` へのリンクだった。LIFF は
 * **LINE アプリ / LINE 内ブラウザへ離脱する**ため、Chrome で押した人は Safari に移され、
 * そこには Shopify のログインが無い。1 回目は「誰か分からない」で失敗し、成功しても
 * 「トークに戻る」しか出口が無くマイページへ帰れなかった。
 *
 * P2 の導線は LIFF を通らない。同じブラウザのまま LINE の認可へ行き、同じブラウザの
 * マイページへ 302 で戻る（`/api/user/line-link/init` → access.line.me →
 * `/api/user/line-link/callback` → cx-agent link-liff → マイページ）。
 * ボタンの実体は `LineLinkageCta`（client component）。
 *
 * LINE 側の入口（リッチメニュー / キーワード → LIFF）は従来どおり `/liff/link` を使う。
 * 連携の登録先（cx-agent の customer_linkages）は両者で同一。
 *
 * 導線を出せるかどうかは **サーバが決める**（init が 503 を返すデプロイでは CTA を畳む）。
 * `NEXT_PUBLIC_LIFF_ID` の有無で判断していた旧方式はもう使わない — 連携に要る資格情報は
 * すべてサーバ側にあり、公開 env の有無は連携可否と一致しないため。
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
    /** 連携から戻ってきた直後に一度だけ出す確認。連携完了「画面」は作らない（要件 4）。 */
    noticeSuccess: "LINE との連携が完了しました。",
    /** 失敗して戻ってきたとき。原因は伏せる（外に検証内訳を出さない）が、黙って戻さない。 */
    noticeError:
      "連携を完了できませんでした。お手数ですが、もう一度お試しください。",
    /** 状態が読めなかったとき。「未連携」と言い切らない（3 値表示）。 */
    statusUnknown:
      "ただいま連携の状態を確認できませんでした。すでに連携がお済みの場合、あらためて連携していただいても二重にはなりません。",
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
    noticeSuccess: "Your LINE account is now linked.",
    noticeError: "We could not complete the link. Please try again.",
    statusUnknown:
      "We could not check your link status just now. If you are already linked, linking again will not create a duplicate.",
  },
} as const;

type Locale = keyof typeof COPY;

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
 *   連携済みには**解除の導線を出す**（`LineUnlinkControl`）。以前ここには「解除の導線は
 *   出さない」と書いてあった。解除が行削除か旗立てかという状態遷移が未確定で、押せる
 *   ボタンを先に置くと定義が実装に引きずられるからだった。その状態遷移が確定した
 *   （連携行は消さず連携を表す列だけを空にする＝配信停止などお客さまの設定を巻き戻さない）
 *   ため、導線を出せるようになった。
 *
 *   `null`（不明）のときは連携導線に加えて「確認できなかった」を明示する。解除が
 *   実際に押せるようになった今、不明を黙って未連携の見た目にすると、**連携済みの人が
 *   「未連携」と読んで解除が要らないと誤解する**。連携ボタンは冪等なので出したままにし、
 *   言い切らない一文だけを足す。
 *
 * @param result 連携フローから戻ってきた直後の結果（`?line_link=success|error`）。
 *   一度きりの確認をこの節の中に出すためだけに使う。**専用の完了画面は作らない**
 *   （旧 LIFF 導線が連携済みの人にも毎回「連携完了」を見せていた問題の再発防止）。
 *   `error` を黙って捨てないのは、失敗して戻ってきた人が「何も起きなかった」と
 *   受け取るのが、まさに P2 で直している体験だから。
 */
export function LineLinkageEntry({
  locale,
  status,
  result,
}: {
  locale: string;
  status?: LineLinkageStatus;
  result?: "success" | "error";
}) {
  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];

  /* 「状態が読めなかった」かどうかは、下の isLinkedForDisplay より **前**に determine する。
     isLinkedForDisplay は型述語（`status is LineLinkageStatus`）なので、else 側で
     status が never に狭まり `status?.linked` を読めなくなるため。 */
  const statusUnknown = status?.linked === null;

  const notice = result ? (
    <p
      className="text-sm text-foreground leading-relaxed"
      data-testid={`line-linkage-notice-${result}`}
      role="status"
    >
      {result === "success" ? t.noticeSuccess : t.noticeError}
    </p>
  ) : null;

  // 連携済み: 状態を伝え、解除の導線を出す。
  if (isLinkedForDisplay(status)) {
    const date = formatLinkedDate(status.linkedAt, locale);
    return (
      <AccountPanelSection title={t.linkedHeading} testId="line-linkage-entry">
        <div className="space-y-2">
          {notice}
          <div className="flex items-start justify-between gap-6">
            <p
              className="text-sm text-muted-foreground leading-relaxed"
              data-testid="line-linkage-linked"
            >
              {date ? t.linkedWithDate.replace("{date}", date) : t.linkedNoDate}
            </p>
            <LineUnlinkControl locale={locale} />
          </div>
        </div>
      </AccountPanelSection>
    );
  }

  /* 未連携 / 不明: 連携導線を出す。押せるかどうか（＝このデプロイに連携の設定があるか）は
     CTA が init に問い合わせて決める。ここでは公開 env を見ない。

     不明（null）のときだけ「確認できなかった」を添える。解除が押せるようになった今、
     不明を黙って未連携の見た目にすると、連携済みの人が「未連携」と読んで解除が
     要らないと誤解する（3 値表示）。 */
  return (
    <AccountPanelSection title={t.heading} testId="line-linkage-entry">
      <div className="space-y-2">
        {notice}
        {statusUnknown ? (
          <p
            className="text-sm text-foreground leading-relaxed"
            data-testid="line-linkage-status-unknown"
            role="status"
          >
            {t.statusUnknown}
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t.description}
          </p>
          <LineLinkageCta label={t.button} />
        </div>
      </div>
    </AccountPanelSection>
  );
}
