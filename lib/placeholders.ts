/**
 * 仮当て値 (PLACEHOLDER) の唯一の置き場所。
 *
 * ## なぜ 1 か所に集めるのか
 *
 * 事業側の確定を待っている値 (初回お届け日など) を
 * 各ページや messages/*.json に直書きすると、
 *
 * - どれが確定値でどれが仮値か区別できない
 * - 差し替え漏れがそのまま本番に出る (法定表記は事故)
 *
 * という 2 つの問題が起きる。そこで値を本ファイルに集約し、各エントリに
 * `status: PLACEHOLDER_MARKER` を持たせて「まだ仮」であることを機械可読にした。
 * ページ側は {@link placeholderValue} 経由でのみ値を読む (直書き禁止)。
 *
 * ## 差し替え手順
 *
 * 1. 実値を確認する (根拠は各エントリの `basis` / 台帳 `docs/placeholders.md`)
 * 2. 該当エントリの `value` を実値にし、`status` を `"confirmed"` に変える
 * 3. `docs/placeholders.md` の該当行を「差し替え済」にする
 *
 * ## 本番ビルドで機械的に止まる仕組み
 *
 * `status: PLACEHOLDER_MARKER` が 1 件でも残っていると公開できない。止める層は 2 つ:
 *
 * - **ビルド (実ブロック)**: `pnpm build` が `next build` の前に
 *   `validate:placeholders` (`scripts/check-placeholders.ts`) を走らせ、未解決が
 *   あれば exit 1 する
 * - **テスト (公開前チェック)**: `__tests__/placeholders.test.ts` が未解決 0 件を要求する
 *
 * **判定は全環境で同じ** (2026-08-12 Setaka 決定)。production / Preview / dev / test を
 * 区別せず、常に落とす。環境で挙動を変えていた旧仕様では Preview が通って本番だけが
 * 落ち、そのたびにガードを無効化する運用になっていた。逃げ道は
 * `ROJI_PLACEHOLDER_GUARD=off` の明示指定 1 つだけ。判定の詳細は
 * {@link placeholderGuardMode}。
 *
 * @see docs/placeholders.md 差し替え台帳 (対象 / 現在の仮値 / 担当 / 根拠)
 */

/** 未確定を表すマーカー。この文字列が残っている限り production ビルドは通らない。 */
export const PLACEHOLDER_MARKER = "ROJI_PLACEHOLDER" as const;

export type PlaceholderStatus = typeof PLACEHOLDER_MARKER | "confirmed";

export type PlaceholderEntry = {
  /** どの画面のどこに出るか (人間向け)。 */
  readonly surface: string;
  /** 画面上のラベル。 */
  readonly label: string;
  /** 画面に実際に出る文字列。 */
  readonly value: string;
  /** `PLACEHOLDER_MARKER` = 仮値 / `"confirmed"` = 実値確定済み。 */
  readonly status: PlaceholderStatus;
  /** 差し替え担当 (誰が実値を持ってくるか)。 */
  readonly owner: string;
  /** 差し替え先の根拠 (どこを見れば実値が分かるか)。 */
  readonly basis: string;
};

/**
 * 仮当て値レジストリ。
 *
 * 法定表記 (`tokushoho.*`) の仮値は **実在の住所・電話番号・個人名に見えない文字列**に
 * すること。万一 guard をすり抜けても、読み手が一目で仮値と分かる状態を保つ。
 * (`status: "confirmed"` に差し替えた後は実値そのものなのでこの制約の対象外。
 * 単体テストも仮値のエントリだけを検査する)
 *
 * 法人情報 (`tokushoho.*` / `about.*`) の実値の SoT は Notion の Corporate Info DB
 * (https://www.notion.so/fc8c353f9650453c9707ae0a806ae484)。ここに無い値を
 * Figma や他ページの記載から拾って「確定」扱いにしないこと (2026-08-10 まで
 * 利用規約 / 特商法 / About Figma の 3 か所で所在地の表記が食い違っていた)。
 *
 * 月額 (旧 `subscription.monthlyPrice`) は本レジストリから外した。Shopify の
 * selling plan を SoT にして `lib/subscription-pricing.ts` が導出する。
 */
export const PLACEHOLDERS = {
  /* ---- 定期便LP (/ja/subscription) ------------------------------------- */
  "subscription.firstDeliveryDate": {
    surface: "定期便LP S2 DateRibbon (Figma 8071:126)",
    label: "初回お届け日",
    // 文字列長を C3-2R 忠実度計測時と同一に保つ (DateRibbon の SP 2 行折返しが
    // 計測前提。長さを変えると帯の高さ実測値が無効になる)。
    // 2026-09-10 は実際に木曜 (曜日表記と日付が食い違わないことを確認済み)。
    value: "9月10日（木）",
    status: "confirmed",
    owner: "Setaka (事業判断)",
    basis:
      "**暫定確定値 (後で変更予定)**。Setaka 決定 2026-08-12: 「初回お届け日は適当な日付で仮確定してよい (後で変更する)」。本来の SoT は Shopify の定期便 selling plan の締日 (cutoff) と起算日 (anchors) から「今申し込むと初回は N 月 N 日」を導出する設計だが、2026-08-10 時点の本番ストアは selling plan group「elxea 定期便プラン」の全 3 プランが anchors=[] / cutoff=null / preAnchorBehavior=ASAP で締日・発送曜日が未設定のため導出できない。Shopify 側に設定が入ったら、この定数を消して計算式に置き換える (差し替え待ち: All Tasks ID-7657 の親スレッド / 台帳 docs/placeholders.md)",
  },

  /* ---- 特定商取引法ページ (/ja/legal/tokushoho) ------------------------ */
  "tokushoho.operationsManager": {
    surface: "特商法ページ S1 販売者 (Figma 7856:932)",
    label: "運営統括責任者",
    value: "温世堅",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条の表示義務。Corporate Info DB の「代表者氏名」(Category=Basic) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)",
  },
  "tokushoho.address": {
    surface:
      "特商法ページ S1 販売者 (Figma 7856:932) / プライバシーポリシー S4 事業者情報 (Figma 不在・利用規約 7850:803 から導出)",
    label: "所在地",
    value: "〒102-0093 東京都千代田区平河町2-5-3 Nagatacho GRID 5F",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条。Corporate Info DB の「本社住所」(Category=Address) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)。`about.headOffice` と同一値 (同時差し替え済み)",
  },
  "tokushoho.phone": {
    surface: "特商法ページ S1 販売者 + S4 お問い合わせ窓口 (Figma 7857:39763)",
    label: "電話番号",
    value: "075-205-1615",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条。Corporate Info DB の「代表電話」(Category=Contact) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)",
  },
  "tokushoho.email": {
    surface:
      "特商法ページ S1 販売者 + S4 お問い合わせ窓口 / お問い合わせ S1 メタ「メール」(Figma 8109:46669 は value をダミーアドレスと明記)",
    label: "メールアドレス",
    value: "info@elxea.com",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "Corporate Info DB の「代表メールアドレス（一般問い合わせ用）」(Category=Contact / 最終確認日あり) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)。roji は層 2 のサービスでサイト運営主体は elxea なので、hello@roji.jp ではなく受信実績のある法人公式アドレスを表に出す (Boss 裁定 2026-08-10)",
  },

  /* ---- 特商法ページ IV 定期便 (継続課金の契約条件) ---------------------- */
  /*
   * 2026-08-11 に追加。定期便の契約条件は法11条・施行規則23条の表示事項なので、
   * 値が確定していない項目を「書かない」で済ませられない (欠落そのものが違反)。
   * そこで文面は先に置き、埋まっていない値だけを仮値ガードに載せて公開を止める。
   *
   * 確定した 4 項目 (送料無料 / 初回1,880円・継続2,280円 / 初回発送は5営業日以内 /
   * 解約はマイページ主) はページ側に直接書いている (Setaka 確定 2026-08-11)。
   *
   * 当初 5 件を登録したが、全件を本番 Shopify とマイページ実装の実測で confirmed 化した
   * (3 件は 2026-08-11 の事実確認調査 https://app.notion.com/p/3b870c9d064c8132b9daf9088fc5df7b、
   * 決済手段は同日の管理画面実測 + Storefront / Admin API 実測)。この群に残る仮値は無い。
   */
  "tokushoho.subscriptionPaymentMethods": {
    surface: "特商法ページ S2 記載事項 IV-4 お支払い方法と時期",
    label: "定期便で利用できる決済手段",
    // 「のみ」を落とさないこと。群 I (単発販売) にはコンビニ決済・銀行振込・代金引換が
    // 並んでおり、限定を外すと定期便でもそれらが使えると読める (不実表示)。
    value: "クレジットカード（Visa、Mastercard、American Express、JCB）のみ",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条2号。単発販売の「クレジットカード、コンビニ決済、銀行振込、代金引換」を流用してはいけない (継続課金で使える手段は Shopify の subscription 対応決済に依存する)。実測で確定 (2026-08-11 JST): (a) Shopify 管理画面のペイメント設定 = Visa / Mastercard / American Express / JCB 有効・PayPal 未有効・テストモード オフ (elxea-admin)、(b) Storefront API `shop.paymentSettings.acceptedCardBrands` = VISA / MASTERCARD / AMERICAN_EXPRESS / JCB (管理画面の「+2」は `supportedDigitalWallets` の APPLE_PAY / GOOGLE_PAY で、カードブランドではない)、(c) 実注文の `paymentGatewayNames` は本番が `shopify_payments` (Shopify Payments が稼働中 = 定期便のカード保管に対応)、(d) 定期便の請求は Shopify の subscriptionBillingAttempt で `customerPaymentMethod` に保管済みの手段へ行う仕組みで、実在契約の instrument は `CustomerCreditCard`。KOMOJU 経由の楽天ペイ / スマホ決済 (コンビニ等)・代金引換 (`Cash on Delivery (COD)`)・銀行振込 (`manual`) は保管して自動請求できないため定期便では使えない。Apple Pay / Google Pay は「使えないから書かない」のではない — Shopify 公式ドキュメント (https://help.shopify.com/en/manual/products/purchase-options/subscriptions/considerations 2026-08-11 取得) は Shopify Payments 利用時について \"Customers can use accelerated checkouts, such as Shop Pay, Apple Pay, Google Pay, or PayPal, to purchase subscriptions\" と明記しており、当店は shopify_payments 稼働のため使える見込みが高い。それでも表記に出さないのは、ウォレットで契約しても保管される instrument はクレジットカード (実在契約の `CustomerCreditCard` と整合) であり、表記をカードブランドに統一した方が正確だから。ウォレット名を並べると \"Apple Pay support for subscriptions is limited to Visa and Mastercard\" (同 doc) の但し書きが要り、かえって読み手を誤らせる。なお同 doc は \"Customers can use only Shop Pay on some stores\" とも述べており、実チェックアウトで定期便カートにウォレットボタンが出るかは未実測 (将来ウォレットを表記するなら実測が前提)。起草 IV-4 / 未確定 U-2 — https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa",
  },
  "tokushoho.subscriptionFirstChargeTiming": {
    surface: "特商法ページ S2 記載事項 IV-4 お支払い方法と時期",
    label: "初回課金のタイミング",
    value: "ご注文の確定時",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条2号。事実確認調査で本番 Shopify の selling plan の billing policy (月単位 / 間隔 1・2・3 / 基準日なし) と実在契約から実測確定 (2026-08-11 JST) — https://app.notion.com/p/3b870c9d064c8132b9daf9088fc5df7b。初回はチェックアウト完了 (注文確定) 時点で課金される。起草 IV-4 / 未確定 U-3 — https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa",
  },
  "tokushoho.subscriptionRecurringChargeTiming": {
    surface: "特商法ページ S2 記載事項 IV-4 お支払い方法と時期",
    label: "2回目以降の課金のタイミング",
    value:
      "お申し込み日を起点として、お選びいただいた間隔ごとに巡ってくる同じ日付（当日の午前中）",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条2号。事実確認調査で実測確定 (2026-08-11 JST) — https://app.notion.com/p/3b870c9d064c8132b9daf9088fc5df7b。billing policy は基準日 (anchors) 未設定なので月初などの固定日ではなく加入日基準の応当日で回る。実際の引き落としは `app/api/cron/billing/route.ts` の cron (vercel.json: 毎日 00:00 UTC = 09:00 JST) が「次回課金日 ≦ 現在時刻」の契約に対して行うため、顧客案内は「当日の午前中」とする。起草 IV-4 / 未確定 U-3 — https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa",
  },
  "tokushoho.subscriptionCancelCutoff": {
    surface: "特商法ページ S2 記載事項 IV-6 停止・解約の方法",
    label: "解約・変更の受付期限",
    value: "次回のご請求日の前日",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "解約の申出に期限があるならその期限の表示が必要 (消費者庁ガイドライン別添9 2(2)⑥)。事実確認調査で実測確定 (2026-08-11 JST) — https://app.notion.com/p/3b870c9d064c8132b9daf9088fc5df7b。技術的な限界は「次回課金日の当日 09:00 JST の cron 実行まで」(解約・停止・スキップは顧客アカウント API を即時呼び出す実装) だが、限界値をそのまま案内すると当日朝の操作が課金と競合するため、調査レポートの推奨どおり余裕を持たせて「前日まで」を顧客向けの受付期限とする。定期便LP の FAQ とリマインドメールも本エントリと同一基準に統一済み (2026-08-11)。回帰は `__tests__/dispatch-lead-time.test.ts` の「解約・変更の受付期限の統一」で機械固定している。起草 IV-6 / 未確定 U-5 — https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa",
  },
  "tokushoho.subscriptionEditableFields": {
    surface: "特商法ページ S2 記載事項 IV-9 お申し込み内容の変更",
    label: "マイページで変更できる項目",
    value:
      "次回お届け分のスキップ、お届け間隔の変更、一時停止、再開、解約",
    status: "confirmed",
    owner: "Setaka (法定表記)",
    basis:
      "変更できない項目を「変更できる」と書くと不実表示になる。事実確認調査で実測確定 (2026-08-11 JST) — https://app.notion.com/p/3b870c9d064c8132b9daf9088fc5df7b。マイページ (`components/account/subscription-actions.tsx` / `app/[locale]/account/subscriptions/page.tsx`) のボタンはこの 5 種のみで、お届け先住所・数量・お支払い方法・商品の変更画面はアカウント配下に存在しない (商品変更のサーバー処理は未接続)。よって IV-9 の文面もこの 5 種だけを「マイページでできる」と書き、それ以外はお問い合わせ窓口に寄せている。起草 IV-9 / 未確定 U-6 — https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa",
  },

  /* ---- About ページ (/ja/about) 会社情報 -------------------------------- */
  "about.headOffice": {
    surface: "About ページ 06 会社情報 (Figma 8121:1312 / SP 8121:1386)",
    label: "本社",
    value: "〒102-0093 東京都千代田区平河町2-5-3 Nagatacho GRID 5F",
    status: "confirmed",
    owner: "Setaka (会社情報)",
    basis:
      "Corporate Info DB の「本社住所」(Category=Address) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)。`tokushoho.address` と同一値で同時に差し替えた。利用規約 S4 / About の Figma が持っていた別表記は採用しない (Corporate Info DB を唯一の正とする)",
  },
  "about.branchOffice": {
    surface: "About ページ 06 会社情報 (Figma 8121:1312 / SP 8121:1386)",
    label: "京都事務所",
    value: "〒601-8014 京都府京都市南区東九条河西町43",
    status: "confirmed",
    owner: "Setaka (会社情報)",
    basis:
      "Corporate Info DB の「京都倉庫住所」(Category=Address) が SoT — https://www.notion.so/fc8c353f9650453c9707ae0a806ae484 (取得 2026-08-10 JST)。Boss 裁定 2026-08-10 で「記載する」に決定。倉庫兼事務所のため画面ラベルは「京都事務所」のまま。非公開に転じる場合は本エントリと About 会社情報の行を落とす (Setaka が後から判断可能)",
  },
} as const satisfies Record<string, PlaceholderEntry>;

export type PlaceholderId = keyof typeof PLACEHOLDERS;

/**
 * 仮当て値を読む唯一の入口。ページ側で値を直書きしないこと。
 */
export function placeholderValue(id: PlaceholderId): string {
  return PLACEHOLDERS[id].value;
}

/** まだ実値に差し替わっていないエントリの id 一覧 (昇順)。 */
export function unresolvedPlaceholderIds(
  entries: Record<string, PlaceholderEntry> = PLACEHOLDERS
): string[] {
  return Object.keys(entries)
    .filter((id) => entries[id].status === PLACEHOLDER_MARKER)
    .sort();
}

export type PlaceholderGuardMode = "error" | "off";

/**
 * 仮値ガードを「落とすモード」で動かすかどうかを決める純関数。
 *
 * **全環境で `error` が既定** (2026-08-12 Setaka 決定)。環境で挙動を変えない:
 *
 * - `ROJI_PLACEHOLDER_GUARD=off` を明示したときだけ `off` (唯一の逃げ道)
 * - それ以外はすべて `error` — production / Preview / dev / test を区別しない
 *
 * ## なぜ環境で分けるのをやめたか
 *
 * 旧仕様は `VERCEL_ENV=production` だけを `error` にしていた。結果、Preview では
 * 未解決の仮値が通ってしまい「Preview で確認 OK → 本番デプロイで初めて落ちる」
 * が毎回起きた。落ちるたびに `ROJI_PLACEHOLDER_GUARD=off` を付けて回避する運用に
 * なり、ガードが本番公開を止める意味を失っていた。環境差をなくせば Preview の
 * 時点で必ず気づけるので、`off` を使う場面そのものが無くなる。
 *
 * ## 代償 (承知の上)
 *
 * 新しい仮値を追加した瞬間から、手元の `pnpm build` / `pnpm test` も落ちる。
 * 「仮値を入れて先に進む」ためにその場をしのぐなら `ROJI_PLACEHOLDER_GUARD=off`
 * を明示的に付ける。既定を緩める (env で自動的に off になる) 形には戻さない。
 *
 * `NODE_ENV` / `VERCEL_ENV` はどちらも見ない (見る必要がなくなった)。
 */
export function placeholderGuardMode(
  env: Record<string, string | undefined>
): PlaceholderGuardMode {
  const override = env.ROJI_PLACEHOLDER_GUARD;
  if (override === "off") return "off";
  return "error";
}

/**
 * production 相当の環境で仮値が残っていたら throw する。
 *
 * @throws Error 未解決の仮値が 1 件以上あり、かつ guard mode が `error` のとき
 */
export function assertPlaceholdersResolved(
  env: Record<string, string | undefined>,
  entries: Record<string, PlaceholderEntry> = PLACEHOLDERS
): void {
  if (placeholderGuardMode(env) !== "error") return;

  const unresolved = unresolvedPlaceholderIds(entries);
  if (unresolved.length === 0) return;

  const detail = unresolved
    .map((id) => `  - ${id} (${entries[id].label}) — 担当: ${entries[id].owner}`)
    .join("\n");

  throw new Error(
    [
      `${PLACEHOLDER_MARKER} が ${unresolved.length} 件残っています。この状態では本番公開できません。`,
      detail,
      "lib/placeholders.ts の value を実値にし status を \"confirmed\" にしてください (台帳: docs/placeholders.md)。",
    ].join("\n")
  );
}
