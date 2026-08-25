import { AccountPanelSection } from "@/components/account/account-panel";
import { LineLinkageCta } from "@/components/account/line-linkage-cta";
import { LineUnlinkControl } from "@/components/account/line-unlink-control";
import { Button } from "@/components/ui/button";
import {
  formatLinkedDate,
  resolveLineLinkageEntryMode,
  type LineLinkageStatus,
} from "@/lib/line/linkage-status";
import type { LinkResult } from "@/lib/line/link-flow";

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
    /** 連携の準備 (認可 URL の取得) に失敗したとき。押せる状態に戻す。 */
    buttonRetry: "もう一度試す",
    /** 同・添える一言。原因は伏せるが、黙って灰色のボタンを残さない。 */
    buttonFailedNote: "連携の準備ができませんでした。",
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
    /**
     * 恒久的な衝突（このメールアドレスには既に別の LINE が連携済み）。
     *
     * ここだけ**原因を伏せない**。伏せてよいのは「やり直せば直るかもしれない」失敗
     * だけで、これはやり直しても直らない。何が起きたかと、次に何をすればよいかを
     * 言わないと、お客さまは同じ操作を繰り返すことになる。
     */
    noticeConflict:
      "このメールアドレスには、すでに別の LINE アカウントが連携されています。連携できるのは 1 つの LINE アカウントだけです。連携先を変えたい場合は、先に今の連携を解除してください。",
    /**
     * 恒久的な衝突・逆向き（この LINE に既に別のメールアドレスが連携済み）。
     *
     * `noticeConflict` と分けるのは文言の好みではなく、**次にやるべきことが逆**だから。
     * こちらのお客さまが解除するには、いま連携中の**別のメールアドレスでログインし直す**
     * 必要がある。この画面で解除ボタンを探しても見つからない。
     */
    noticeLineConflict:
      "この LINE アカウントは、すでに別のメールアドレスと連携されています。連携できるのは 1 つのメールアドレスだけです。連携先を変えたい場合は、先に連携中のメールアドレスでログインして、連携を解除してください。",
    /** 状態が読めなかったとき。「未連携」と言い切らない（3 値表示）。 */
    statusUnknown:
      "ただいま連携の状態を確認できませんでした。すでに連携がお済みの場合、あらためて連携していただいても二重にはなりません。",
    /** LINE でログイン中の見出し。 */
    statusHeading: "メールアドレスと連携する",
    /**
     * LINE だけでログインしている人への説明（ワンタップ・J-1 案A）。
     *
     * 「メールアドレスでログイン」ではなく「連携する」と言い切ってよくなった。
     * Wave 1 でこの文言を「ログイン」に正したのは、当時のボタンが**押しても定義上
     * 100% 何も起きなかった**ためで（設計書 §1-2）、名前が実体と食い違っていたから
     * である。ワンタップは戻ってきた時点で台帳に行が立つので、いまは実体が言葉に
     * 追いついている。
     */
    oneTapDescription:
      "ご注文や定期便の状況をこの画面でご覧いただくには、お使いのメールアドレスとの連携が必要です。連携すると、LINE で保存されたお気に入りもそのまま引き継がれます。",
    oneTapButton: "メールアドレスと連携する",
    /** LINE でログイン中に状態が読めなかったとき。 */
    statusUnknownNoCta:
      "ただいま連携の状態を確認できませんでした。すでに連携がお済みの場合、あらためて連携していただいても二重にはなりません。",
  },
  en: {
    heading: "Link with LINE",
    description:
      "Connect your LINE with this account to receive suggestions tailored to your taste right in the LINE chat. You can also check your orders and subscription from the chat.",
    button: "Link with LINE",
    buttonRetry: "Try again",
    buttonFailedNote: "We could not prepare the link just now.",
    linkedHeading: "Linked with LINE",
    linkedWithDate:
      "Linked with LINE since {date}. We send suggestions tailored to your taste in the LINE chat.",
    linkedNoDate:
      "Linked with LINE. We send suggestions tailored to your taste in the LINE chat.",
    noticeSuccess: "Your LINE account is now linked.",
    noticeError: "We could not complete the link. Please try again.",
    noticeConflict:
      "This email address is already linked to a different LINE account. Only one LINE account can be linked at a time. To link a different one, please unlink the current account first.",
    noticeLineConflict:
      "This LINE account is already linked to a different email address. Only one email address can be linked at a time. To link it here instead, please sign in with that email address and unlink it first.",
    statusUnknown:
      "We could not check your link status just now. If you are already linked, linking again will not create a duplicate.",
    statusHeading: "Link your email address",
    oneTapDescription:
      "To see your orders and subscription here, link the email address you use with elxea. Anything you saved while signed in with LINE comes with you.",
    oneTapButton: "Link your email address",
    statusUnknownNoCta:
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
 * @param result 連携フローから戻ってきた直後の結果
 *   （`?line_link=success|error|conflict|line-conflict`）。
 *   一度きりの確認をこの節の中に出すためだけに使う。**専用の完了画面は作らない**
 *   （旧 LIFF 導線が連携済みの人にも毎回「連携完了」を見せていた問題の再発防止）。
 *   `error` を黙って捨てないのは、失敗して戻ってきた人が「何も起きなかった」と
 *   受け取るのが、まさに P2 で直している体験だから。
 *
 *   `conflict`（既に別の LINE が連携済み）は `error` と**分ける**。恒久的な衝突なので
 *   「もう一度お試しください」は嘘になる — 何度試しても成功しない。M-1 / J-4。
 *   `line-conflict`（この LINE に既に別のメールアドレスが付いている）はその逆向きで、
 *   **解除できる場所がもう一方のアカウント側にある**ため、案内すべき行動が違う。
 *
 * @param canLink Shopify の顧客セッションがあるか（＝メールでログインしているか）。
 *   既定 `true`（従来の呼び出し方＝メールでログインしている人）。
 *
 *   LINE だけでログインしている人には `false` を渡す。この値は「連携できるか」ではなく
 *   **どちらの入口を出すか**を決める。
 *
 *   - `true`  … `LineLinkageCta`（LINE の認可へ行く。P2 の導線）
 *   - `false` … ワンタップの入口 `/api/user/line-link/intent`（J-1 案A）
 *
 *   以前この場所には「LINE だけの人には連携ボタンを出さない」と書いてあった。
 *   `/api/user/line-link/init` が Shopify セッションを要求するので、押しても入口で
 *   弾かれるボタンを出さない、という判断で、当時それは正しかった。ただしその結果
 *   **LINE だけで使っている人のマイページには連携の入口が 1 つも無い**状態が残った。
 *   連携が一番必要な人に、連携の話が出てこない。ワンタップの入口は Shopify セッションを
 *   要求しないので、その前提はもう成立しない（設計書 §3-4 の L4 緩和の枠内）。
 *
 *   **解除は別**で、連携済みなら `canLink` に関係なく状態と解除の導線を出す
 *   （解除の対象は台帳の自分の行なので、LINE セッションでも指定できる）。ここが
 *   出ていなかったのが「LINE でログインすると連携を解除できない」の正体。
 *   出し分けの決定は `resolveLineLinkageEntryMode` に置いてテストで縛る。
 */
export function LineLinkageEntry({
  locale,
  status,
  result,
  canLink = true,
}: {
  locale: string;
  status?: LineLinkageStatus;
  result?: LinkResult;
  canLink?: boolean;
}) {
  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];

  const mode = resolveLineLinkageEntryMode({ canLink, status });

  /* 「状態が読めなかった」かどうか（3 値の null）。連携済みかどうかとは別の軸。 */
  const statusUnknown = status?.linked === null;

  const notice = result ? (
    <p
      className="text-sm text-foreground leading-relaxed"
      data-testid={`line-linkage-notice-${result}`}
      role="status"
    >
      {result === "success"
        ? t.noticeSuccess
        : result === "conflict"
          ? t.noticeConflict
          : result === "line-conflict"
            ? t.noticeLineConflict
            : t.noticeError}
    </p>
  ) : null;

  // 連携済み: 状態を伝え、解除の導線を出す（ログイン経路によらず同じ）。
  if (mode === "linked") {
    const date = formatLinkedDate(status?.linkedAt ?? null, locale);
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

  /* LINE だけでログインしている人の入口（ワンタップ・J-1 案A / L4 緩和）。
   *
   * ここは以前 **何も出さなかった**（`hidden`）。`/api/user/line-link/init` が Shopify
   * セッションを要求するので「押しても弾かれるボタンを出さない」という判断で、当時は
   * 正しかった。ただしその結果、LINE だけで使っている人のマイページには連携の入口が
   * 1 つも無い状態が残った — 連携が一番必要な人に、連携の話が出てこない。
   *
   * ワンタップの入口 `/api/user/line-link/intent` は Shopify セッションを要求しない。
   * 押した瞬間に意思を封緘してログインへ送り、帰り道（`/api/auth/callback`）で台帳に
   * 行を立てる。よって「押しても弾かれる」はもう成立しない。
   *
   * ## なぜ素の `<a>` なのか（client component にしない）
   *
   * この導線は「cookie を 1 本置いて 302」するだけで、事前に取りに行くものが無い。
   * `LineLinkageCta` が client component なのは、LINE の自動ログインを発火させるために
   * 認可 URL を**先読みして実 `<a>` に載せる**必要があるからで、ここにその制約は無い。
   *
   * 状態が読めなかったときは、入口を出したうえで一言添える。連携は冪等なので
   * 二度押しても壊れず、黙って未連携の顔をするより安全側（`link-cta` と同じ判断）。 */
  if (mode === "one-tap-cta") {
    return (
      <AccountPanelSection title={t.statusHeading} testId="line-linkage-entry">
        <div className="space-y-2">
          {notice}
          {statusUnknown ? (
            <p
              className="text-sm text-foreground leading-relaxed"
              data-testid="line-linkage-status-unknown"
              role="status"
            >
              {t.statusUnknownNoCta}
            </p>
          ) : null}
          <div className="flex items-start justify-between gap-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.oneTapDescription}
            </p>
            <Button variant="secondary" className="shrink-0 shadow-xs" asChild>
              {/* Route Handler なので next/link ではなく素の `<a>` で遷移させる。 */}
              <a
                href={`/api/user/line-link/intent?locale=${encodeURIComponent(locale)}`}
                data-testid="line-linkage-one-tap-cta"
              >
                {t.oneTapButton}
              </a>
            </Button>
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
          <LineLinkageCta
            label={t.button}
            retryLabel={t.buttonRetry}
            failedNote={t.buttonFailedNote}
          />
        </div>
      </div>
    </AccountPanelSection>
  );
}
