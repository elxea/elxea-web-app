/**
 * 仮当て値 (PLACEHOLDER) の唯一の置き場所。
 *
 * ## なぜ 1 か所に集めるのか
 *
 * 事業側の確定を待っている値 (初回お届け日 / 月額 / 法定表記の住所・電話・責任者名) を
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
 * `status: PLACEHOLDER_MARKER` が 1 件でも残っていると本番公開できない。止める層は 2 つ:
 *
 * - **ビルド (本番の実ブロック)**: `pnpm build` が `next build` の前に
 *   `validate:placeholders` (`scripts/check-placeholders.ts`) を走らせ、
 *   production 判定時に exit 1 する。dotenv を読まない素の node プロセスなので、
 *   Vercel が注入する `VERCEL_ENV=production` にだけ反応する
 * - **テスト (公開前チェック)**: `__tests__/placeholders.test.ts` は
 *   `ROJI_PLACEHOLDER_GUARD=error` を明示したときだけ未解決 0 件を要求する。
 *   vitest は `.env.local` を process.env に読み込むため `VERCEL_ENV` で発火させると
 *   手元の env ファイル次第で通常の `pnpm test` が落ちてしまう (実際にこのリポジトリの
 *   手元環境の `.env.local` が `VERCEL_ENV="production"` を持っていた)
 *
 * production 判定は Vercel が自動注入する `VERCEL_ENV=production` のみ
 * (dev / Preview は落とさない = 作業を止めない)。CI や手元での動作確認用に
 * `ROJI_PLACEHOLDER_GUARD=error` で強制、`=off` で無効化できる。
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
 */
export const PLACEHOLDERS = {
  /* ---- 定期便LP (/ja/subscription) ------------------------------------- */
  "subscription.firstDeliveryDate": {
    surface: "定期便LP S2 DateRibbon (Figma 8071:126)",
    label: "初回お届け日",
    // 文字列長を C3-2R 忠実度計測時と同一に保つ (DateRibbon の SP 2 行折返しが
    // 計測前提。長さを変えると帯の高さ実測値が無効になる)。
    value: "9月10日（木）",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (事業判断)",
    basis:
      "Shopify の定期便 selling plan の初回発送サイクル確定後に決まる。締日と発送曜日が確定したら「今申し込むと初回は N 月 N 日」を計算式に置き換える (定数のままにしない)",
  },
  "subscription.monthlyPrice": {
    surface: "定期便LP 料金SpecBand (Figma 8071:462) / 申し込みブロック (8071:514)",
    label: "月額",
    value: "1,800円",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (価格決定)",
    basis:
      "Shopify 定期便商品 (tag: subscription) の selling plan 価格が SoT。確定後は本定数を消し、`detail.sellingPlanGroups` の実価格を描画する",
  },

  /* ---- 特定商取引法ページ (/ja/legal/tokushoho) ------------------------ */
  "tokushoho.operationsManager": {
    surface: "特商法ページ S1 販売者 (Figma 7856:932)",
    label: "運営統括責任者",
    value: "（公開前に差し替え）運営統括責任者 氏名未確定",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (法定表記)",
    basis: "特定商取引法 第11条の表示義務。法人登記の代表者氏名を記載する",
  },
  "tokushoho.address": {
    surface:
      "特商法ページ S1 販売者 (Figma 7856:932) / プライバシーポリシー S4 事業者情報 (Figma 不在・利用規約 7850:803 から導出)",
    label: "所在地",
    value: "（公開前に差し替え）所在地未確定",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (法定表記)",
    basis:
      "特定商取引法 第11条。法人登記上の所在地。利用規約 S4 (app/[locale]/legal/terms/page.tsx) が別の所在地を載せており不一致 — どちらを正とするか要確認",
  },
  "tokushoho.phone": {
    surface: "特商法ページ S1 販売者 + S4 お問い合わせ窓口 (Figma 7857:39763)",
    label: "電話番号",
    value: "（公開前に差し替え）電話番号未確定",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (法定表記)",
    basis: "特定商取引法 第11条。実際に受電できる番号のみ記載可 (受付時間と整合させる)",
  },
  "tokushoho.email": {
    surface:
      "特商法ページ S1 販売者 + S4 お問い合わせ窓口 / お問い合わせ S1 メタ「メール」(Figma 8109:46669 は value をダミーアドレスと明記)",
    label: "メールアドレス",
    value: "hello@roji.jp",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (法定表記)",
    basis:
      "受信可能なアドレスであることの確認が未了 (Figma 凍結版の値をそのまま置いている)。MX / 受信テストが通れば `confirmed` にする",
  },

  /* ---- About ページ (/ja/about) 会社情報 -------------------------------- */
  "about.headOffice": {
    surface: "About ページ 06 会社情報 (Figma 8121:1312 / SP 8121:1386)",
    label: "本社",
    // Figma 確定版は実在しそうな住所を置いているが、法人登記の所在地としては
    // 確定していない (特商法ページ・利用規約とも値が食い違っている)。
    // 一目で仮値と分かる文字列に置き換えて出す。
    value: "（公開前に差し替え）本社所在地未確定",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (会社情報)",
    basis:
      "法人登記上の所在地。`tokushoho.address` と同一の値になるはずで、確定時は両方を同時に差し替える (現状は Figma / 利用規約 / 特商法の 3 か所で値が食い違っている)",
  },
  "about.branchOffice": {
    surface: "About ページ 06 会社情報 (Figma 8121:1312 / SP 8121:1386)",
    label: "京都事務所",
    value: "（公開前に差し替え）京都事務所所在地未確定",
    status: PLACEHOLDER_MARKER,
    owner: "Setaka (会社情報)",
    basis:
      "第 2 拠点の所在地。そもそも公開するかどうか自体が未決 (公開しないなら本エントリを削除し、会社情報の行も落とす)",
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
 * - `ROJI_PLACEHOLDER_GUARD` の明示指定が最優先 (`error` / `off`)
 * - 次に `VERCEL_ENV === "production"` なら `error`
 * - それ以外 (dev / Preview / test) は `off` = 作業を止めない
 *
 * `NODE_ENV` は見ない。`next build` はローカルでも `NODE_ENV=production` になるため、
 * これで判定すると Preview 用ビルドまで落ちてしまう。
 */
export function placeholderGuardMode(
  env: Record<string, string | undefined>
): PlaceholderGuardMode {
  const override = env.ROJI_PLACEHOLDER_GUARD;
  if (override === "error") return "error";
  if (override === "off") return "off";
  return env.VERCEL_ENV === "production" ? "error" : "off";
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
