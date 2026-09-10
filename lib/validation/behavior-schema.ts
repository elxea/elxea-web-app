import { z } from "zod";

/**
 * `/api/user/behavior` が受け取る形。**送り手 (`lib/firebase/behavior-tracker.ts`)
 * と対になる契約**なので、画面にもサーバにも属さない場所に置く。
 *
 * ## なぜ route から出したか
 *
 * この受け口はもともと route ファイルの中だけにあり、送り手と突き合わせる術が
 * 無かった。そのため `durationSeconds` (読了までの秒数) を送るようになったとき、
 * 白名簿への追加が漏れたことに**誰も気づけなかった** — `.strict()` が弾いて
 * 400 を返し、その 400 はブラウザの console にしか出ないので、記事の読了イベント
 * だけが何か月も丸ごと欠け続けた (監査 P1-3 / 人気記事の集計から読了が脱落)。
 *
 * ここに出しておけば、送り手が実際に組み立てた本文をそのまま検証する契約テスト
 * (`__tests__/behavior-payload-contract.test.ts`) が書ける。次に項目が増えたときは
 * その場でテストが落ちる。
 */

export const BehaviorActionSchema = z.enum([
  "tap_button",
  "view_content",
  "view_product",
  "purchase",
  "line_message",
  "search",
  "audio_play",
]);

/**
 * Explicit whitelist. Do NOT use `.catchall()` — behavior payloads come from
 * untrusted client code and unbounded metadata defeats validation. If a new
 * field is needed, add it here with an explicit length/type constraint
 * (**and the contract test will tell you if you forget**).
 */
export const BehaviorMetadataSchema = z
  .object({
    contentId: z.string().max(300).optional(),
    productId: z.string().max(300).optional(),
    query: z.string().max(500).optional(),
    buttonLabel: z.string().max(300).optional(),
    targetUrl: z.string().max(2048).optional(),
    referrer: z.string().max(2048).optional(),
    /**
     * 読了までの秒数 (`trackArticleRead`)。型 (`BehaviorEventMetadata`) には
     * 最初から載っていたのに、この白名簿にだけ無かった項目 (監査 P1-3)。
     *
     * 上限は 24 時間。1 記事の滞在としてそれ以上は計測誤り (タブ放置) なので、
     * 集計に混ぜない。
     */
    durationSeconds: z.number().int().min(0).max(86400).optional(),
  })
  .strict();

/**
 * 匿名来訪者の端末を指す不透明 ID（CDP 統合 Stage 1 / 欠陥 D2）。
 *
 * 32 桁の 16 進数固定。発行側は `lib/cdp/anonymous-id.ts`。
 * ここで形を縛るのは、任意文字列を受けると **L0 に幽霊の主体をいくらでも生やせる**
 * ため（ブラウザから来る値なので信用しない）。
 */
export const AnonymousIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

export const BehaviorBodySchema = z.object({
  action: BehaviorActionSchema,
  channel: z.enum(["web", "line", "shopify"]).optional(),
  metadata: BehaviorMetadataSchema.optional(),
  anonymousId: AnonymousIdSchema.optional(),
});
