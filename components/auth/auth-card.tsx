/**
 * 認証画面 (ログイン / ログイン完了) の共有 DS 部品。
 *
 * Figma【R2: 確定版】file `AWLnI0XF07e8rScuxPYPc7`
 * - ログイン        section 6702:8970 / Auth Card 6702:9009 (PC) / 6706:14449 (SP)
 * - ログイン完了    section 6749:10277 / Complete Card 6750:10383 (PC) / 6750:15885 (SP)
 *
 * 2 画面のカード外殻・見出し・アクション列は Figma 上で完全に同一寸法なので、
 * ここで 1 セットに共通化して両ページから使う (画面ごとの写し実装を作らない)。
 *
 * 実測値 (PC / SP):
 * - Section     py 80 / 48、card は px 20 の外側余白の中で最大 420 中央寄せ
 * - Card        p 32 / 24、gap 24 / 20、bg=card、border 1px、radius-xl 12
 * - Header      gap 8、kicker 12px、title 24 / 20 (weight は画面ごと)、desc 14px
 * - Actions     gap 16 (ログイン完了 SP のみ 12)
 * - Banner      h 44、px 16 / py 12、radius-md 6、text 14px center
 */
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * ページ側のセクション枠。
 * Figma は Login Section 6702:9008 / Complete Section 6749:10315。
 * 縦中央寄せ (min-h + items-center) は Figma に無いため付けない —
 * ヘッダー直下に通常フローで積む。
 */
function AuthSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="auth-section"
      className={cn("w-full px-5 py-12 md:py-20", className)}
    >
      {/* max-w-105 = 420px (Figma PC カード幅)。SP は px-5 で 350px に収まる */}
      <div className="mx-auto w-full max-w-105">{children}</div>
    </div>
  );
}

/** カード外殻 (Figma 6702:9009 / 6750:10383)。 */
function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="auth-card"
      className={cn(
        "flex flex-col items-center gap-5 rounded-xl border border-border bg-card p-6 md:gap-6 md:p-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 見出しブロック (Figma Header Block 6702:9010 / Heading 6750:10386)。 */
function AuthCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="auth-card-header"
      className={cn("flex w-full flex-col items-center gap-2 text-center", className)}
    >
      {children}
    </div>
  );
}

/** キッカー (Figma 6702:9011「Account」)。 */
function AuthCardKicker({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-slot="auth-card-kicker"
      className="text-xs leading-4 font-medium text-muted-foreground"
    >
      {children}
    </p>
  );
}

/**
 * カード見出し。
 *
 * Figma は SP 20px / PC 24px。base の `h1 { font: … }` (32px / 300) は unlayered な
 * ため Tailwind utilities からは上書きできず、`app/globals.css` の
 * `h1.auth-card-title` (unlayered) でサイズと太さを当てている
 * (`.hero-display` / `.page-title` / `.contact-title` と同じ作法)。
 *
 * `emphasis="strong"` はログイン完了の「連携完了」(Figma 6750:10387 = weight 700)。
 * 既定はログインの「elxea にログイン」(Figma 6702:9012 = weight 500)。
 */
function AuthCardTitle({
  children,
  emphasis,
}: {
  children: React.ReactNode;
  emphasis?: "strong";
}) {
  return (
    <h1 className="auth-card-title" data-emphasis={emphasis}>
      {children}
    </h1>
  );
}

/** 見出し直下の説明文 (Figma 6702:9013 / 6750:10388)。 */
function AuthCardDescription({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-slot="auth-card-description"
      className="w-full text-sm leading-5 text-muted-foreground"
    >
      {children}
    </p>
  );
}

/** ボタン列 (Figma Actions 6702:9014 / 6750:15804)。 */
function AuthCardActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="auth-card-actions"
      className={cn("flex w-full flex-col items-center gap-4", className)}
    >
      {children}
    </div>
  );
}

/**
 * 「または」区切り行 (Figma Separator 6702:9018 / 6706:14458)。
 * Figma は行そのものを h=100 の枠にして罫線を上下中央に置く (ボタン間を大きく空ける
 * 意図的な余白)。h-25 = 100px。罫線の溝は gap 12。
 */
function AuthCardDivider({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="auth-card-divider"
      className="flex h-25 w-full items-center gap-3"
    >
      <Separator className="flex-1" />
      <span className="text-xs leading-4 text-muted-foreground">{children}</span>
      <Separator className="flex-1" />
    </div>
  );
}

/** カード末尾の注記 (Figma 6702:9024 = 利用規約 / プライバシーポリシー同意文)。 */
function AuthCardFootnote({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-slot="auth-card-footnote"
      className="w-full text-center text-xs leading-4 text-muted-foreground"
    >
      {children}
    </p>
  );
}

/**
 * 完了マーク (Figma Check Circle 6750:10384)。
 * 64px の success 円 + チェック。Figma はテキストグリフ「✓」だが、
 * アイコンは lucide に寄せる本リポの作法に合わせて children でアイコンを受ける。
 *
 * C17-1 (Q3): チェックの色を `primary-foreground` (= 純白) から
 * `success-foreground` に変えた。円は `success` (oklch 0.807) なので白抜きだと
 * **1.79:1** で、WCAG 1.4.11 の非テキストコントラスト 3:1 に届かない
 * (この✓は「完了した」という状態を伝える唯一の図なので装飾例外に当たらない)。
 * `success-foreground` (oklch 0.397) にすると同じ円の上で 3:1 を超える。
 * 実測値は忠実度対比表 (docs/fidelity/c6-1-fidelity.md) に載せる。
 *
 * 円の色・寸法・角丸は Figma のまま。`success` / `success-foreground` は
 * DS が対で持つ意味色なので、生カラーは書かない。
 */
function AuthCardMark({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="auth-card-mark"
      className="bg-success text-success-foreground flex size-16 items-center justify-center rounded-full"
    >
      {children}
    </div>
  );
}

/**
 * 状態バナー (Figma AuthErrorBanner 5344:3 / LinkSuccessBanner 5344:5)。
 *
 * 枠線色は Figma どおり tone 別 (success / destructive)。文字色は Figma が
 * 枠線と同じ薄色 (success #9ecbc0 on background #ebe9e0 = 1.43:1) を指すが
 * WCAG AA 4.5:1 に届かないため `*-foreground` 側を使う (詳細は忠実度対比表)。
 */
function AuthCardBanner({
  tone,
  children,
  ...props
}: React.ComponentProps<"div"> & { tone: "success" | "error" }) {
  return (
    <div
      data-slot="auth-card-banner"
      data-tone={tone}
      className={cn(
        "flex h-11 w-full flex-col items-center justify-center rounded-md border bg-background px-4 py-3 text-center text-sm leading-5",
        tone === "success"
          ? "border-success text-success-foreground"
          : "border-destructive text-destructive",
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  AuthSection,
  AuthCard,
  AuthCardHeader,
  AuthCardKicker,
  AuthCardTitle,
  AuthCardDescription,
  AuthCardActions,
  AuthCardDivider,
  AuthCardFootnote,
  AuthCardMark,
  AuthCardBanner,
};
