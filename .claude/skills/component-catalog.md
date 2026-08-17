# Component Catalog スキル

elxea-web-app の UI コンポーネント管理に使う。

## コンポーネント一覧（56個）

### 実際に使用中（10個）
app/ 配下で import されている:

| コンポーネント | import 元 | 主な使用箇所 |
|-------------|----------|------------|
| Button | `@/components/ui/button` | 全ページ（CTA、ナビ、カート、フォーム） |
| Card (+Header/Title/Description/Content/Footer) | `@/components/ui/card` | subscription, about, contact |
| Badge | `@/components/ui/badge` | product-card（タグ表示） |
| Input | `@/components/ui/input` | search, contact フォーム |
| Label | `@/components/ui/label` | フォーム |
| Separator | `@/components/ui/separator` | header, footer, cart, account |
| Dialog | `@/components/ui/dialog` | image-gallery（商品画像拡大） |
| Sheet | `@/components/ui/sheet` | header（モバイルメニュー） |
| Skeleton | `@/components/ui/skeleton` | ローディング状態 |
| Sonner (Toaster) | `@/components/ui/sonner` | layout（通知） |

### 未使用（46個）
accordion, alert, alert-dialog, aspect-ratio, avatar, breadcrumb, button-group, calendar, carousel, chart, checkbox, collapsible, combobox, command, context-menu, direction, drawer, dropdown-menu, empty, field, form, hover-card, input-group, input-otp, item, kbd, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, sidebar, slider, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip

## Storybook 構成

### Stories ディレクトリ
```
components/ui/*.stories.tsx    ← 各コンポーネントの個別 stories（56個）
stories/
  ActiveComponents.stories.tsx ← 使用中10個を1ページに集約
  tokens/
    Colors.stories.tsx         ← カラーパレット表示
    Radius.stories.tsx         ← border-radius スケール
    Spacing.stories.tsx        ← spacing スケール
    Typography.stories.tsx     ← タイポグラフィ一覧
```

### カタログの階層 (story titleの規約)

サイドバーは **抽象度順** に並べる。番号は並び順の制御用で、`.storybook/preview.ts`
の `options.storySort` がtitleの昇順で並べる (同一title内 = 1ファイル内の
storyの順番は書いた順のまま保つ)。

```
01 Foundations/   色・字・余白・角丸・レイアウト骨格 (トークンの見本)
02 Elements/      単独で意味を持つ基礎部品 (shadcn/ui の 56 個 + Overview)
03 Patterns/      複数部品を組み合わせた複合部品 (Cart / ChatPanel / HeroSection 等)
04 Visualizations/
     Flavor/      味と香りの図 (FlavorMatrix / AromaField / TasteMap)
     Terroir/     土地の地図 (LensMap / OverviewMap)
05 Media/         音の部品 (AudioDock / AudioWaveform)
06 Pages/         画面単位 (現時点で該当 story なし)
99 Preview/       未確定・差し替え前提のモックアップ (Me)
```

新しいstoryを足すときは **既存の番号グループのどれかに入れる**。
新しいトップレベルグループを勝手に作らない (階層はSetaka承認事項)。

### Storybook起動
```bash
pnpm design-catalog     # elxea Design System カタログ dev server (port 6006)
pnpm build:design-catalog    # static build
```

### コンポーネント使用状況の確認
```bash
pnpm audit:components   # 全コンポーネントの使用状況レポート
```

## コンポーネント追加手順

### shadcn/ui からの追加
```bash
# 1. コンポーネントを追加
pnpm dlx shadcn@latest add [component-name]

# 2. stories ファイルを作成
# components/ui/[component-name].stories.tsx
```

### Stories テンプレート
```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ComponentName } from "./component-name";

const meta = {
  title: "02 Elements/ComponentName",
  component: ComponentName,
  tags: ["autodocs"],
  parameters: {
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof ComponentName>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // default props
  },
};

export const Variant: Story = {
  args: {
    variant: "secondary",
  },
};
```

## Active Components ページの更新

`stories/ActiveComponents.stories.tsx` は実際に使用中の10コンポーネントだけを集めたページ。

新しいコンポーネントを app/ で使い始めたら:
1. `pnpm audit:components` で使用状況を確認
2. `ActiveComponents.stories.tsx` に追加
3. 各セクションに使用箇所のメモを含める

## コンポーネントアーキテクチャ

- **ベース**: shadcn/ui（Radix UI + Tailwind CSS）
- **バリアント管理**: class-variance-authority (CVA)
- **スタイリング**: CSS 変数（dist/tokens.css 経由）
- **アクセシビリティ**: Radix UI が提供（WAI-ARIA 準拠）
- **フォント**: Adobe Fonts (Typekit) — termina, neue-haas-grotesk-text, ryo-gothic-plusn, kozuka-gothic-pro

## ビジュアルリグレッション

```bash
pnpm chromatic    # Chromatic で全 stories のスクリーンショット比較
```

PR 作成時に自動実行され、視覚的な差分を検出する。
