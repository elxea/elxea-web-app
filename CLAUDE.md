# elxea Web App — プロジェクト技術仕様

elxea EC サイト（Next.js ヘッドレスコマース）のプロジェクト固有ルール。

エージェント定義（責務・権限・Devlog・制約）は `elxea-developer/CLAUDE.md` を参照。

## Gitルール（厳守）
- **本番の正本は `main`。Vercel productionは `main` から配信される**（`main` HEADに入ったコミットだけが本番になる）。詳細・監視・ロールバック時の注意は `docs/ops/production-source-of-truth.md` を正本とする
- 開発作業はdeveloperブランチで行う
- mainへの直接pushは禁止
- developer → mainのマージはCI全PASS後のみ
- コミットメッセージはconventional commitsに従う（feat:, fix:, ci:, test:, docs:, chore:）

### Git運用の再発防止レジーム（docs/ops/）
259コミット乖離・本番認識割れ・検証停止の再発防止策。各項目の正本は下記ドキュメント。
- `docs/ops/production-source-of-truth.md` — 本番=mainの宣言 + 本番↔main一致監視（P2 / 追加a）
- `docs/ops/branch-divergence.md` — ブランチ乖離監視・停止しきい値（P3）
- `docs/ops/merge-governance.md` — mainへのマージ経路の限定・権限分離（P6 / 追加c）
- `docs/ops/branch-protection.md` — GitHubブランチ保護の前提・費用・緊急バイパス手順（P1）

## アーキテクチャ

- Runtime: Next.js 15 + React 19 + TypeScript（App Router）
- Styling: Tailwind CSS v4.2 + shadcn/ui（new-york）+ Radix UI + CVA
- CMS: Sanity.io（コンテンツ）+ Notion（タスク・運用）
- EC: Shopify Storefront API（ヘッドレス）
- Auth/DB: Firebase（Firestore + Auth）
- Deploy: Vercel
- i18n: next-intl（日本語 primary）
- Package Manager: pnpm

## デザインシステム方針

> **共通業務フロー**: デザイン提案・制作の共通フロー（2 モード / DS 準拠 / トークン束縛 / 二層チェック / 成果物台帳）は全プロジェクト共通の `design-workflow` skill を正本とする（詳細 = Design Ops Spec）。本節はプロジェクト固有の DS 差分を述べる。

### 原則: SoT は対象テンプレートによって分離

デザインシステムの Source of Truth (SoT) は一律ではなく、テンプレートの優先度に応じて段階的に移行する。

| 対象 | SoT | 運用方針 |
|---|---|---|
| Critical 2 テンプレート (商品詳細 + 購入フロー) | **Figma = SoT (新 DS)** | dogfood Spec section 3 の方針逆転を適用。Figma の変数・コンポーネントを正規定義とし、コードはそれに追従する |
| 他テンプレート（凍結期間中） | **Code = SoT (既存 DS)** | 凍結期間中は現行コード定義を維持。変更は最小限 |
| 段階移行 | 別タスクで策定 | dogfood Phase B 完了後に全テンプレートの Figma=SoT 化を検討 |

関連ドキュメント:
- dogfood Spec: https://www.notion.so/36970c9d064c8166b31ef4be3b60a8c5
- Decision Log: https://www.notion.so/36970c9d064c818ab8e9f9a16b37e2a1

### Design Token アーキテクチャ

**Tailwind v4 `@theme`（`app/globals.css`）が唯一のトークン定義場所。**

3層モデル（W3C Design Tokens 標準準拠）:

| 層 | 例 | 定義場所 |
|---|---|---|
| Core（生の値） | `oklch(0.205 0 0)` | `@theme` 内の CSS 変数 |
| Semantic（用途別） | `--color-primary`, `--color-muted` | `@theme` 内の CSS 変数 |
| Component（適用値） | CVA variants 内の Tailwind クラス | 各 `components/ui/*.tsx` |

ルール:
- **生の値（HEX/OKLCH/px）をコンポーネント内に直書き禁止** → 必ず `@theme` トークン経由
- **`bg-[#xxx]` 等の arbitrary value は原則禁止** → トークンが足りなければ `@theme` に追加してから使う
- 色は OKLCH カラースペースで統一（知覚的均一性）
- フォントは `--font-sans`（本文）/ `--font-heading`（見出し）の2系統。追加する場合は `@theme` に定義

### Figma 正本ファイルと SoT 方針（案 B）

- **Figma 正本ファイルキー = `AWLnI0XF07e8rScuxPYPc7`**（旧 `alDl0i3hZvRlqCxH9Li5Q4` は使用しない）。`scripts/design-system/sync-figma-read.ts` の `DEFAULT_FILE_KEY` および `.claude/skills/figma-sync.md` と一致させる。
- **SoT 方針（案 B）**: トークン値の正本は Code（`tokens/elxea-custom.json` + `base.json` / `globals.css` の `@theme`）。Figma は参照用であり、値の二重管理はしない。
- **Code Connect は現状不採用**: Figma Organization プラン必須のため、当面は採用しない（コード→Figma の同期は Variable Rebinder プラグインで運用）。

### コンポーネントシステム: shadcn/ui

**shadcn/ui（new-york スタイル）を公式コンポーネント基盤とする。**

構成:
- プリミティブ: Radix UI（アクセシビリティ・振る舞い）
- バリアント管理: CVA（class-variance-authority）
- クラス結合: `cn()` = clsx + tailwind-merge（`lib/utils.ts`）
- アイコン: Lucide React
- 配置: `components/ui/` に shadcn/ui コンポーネントを格納

コンポーネント追加手順:
1. `npx shadcn@latest add <component>` で追加
2. プロジェクト固有のカスタマイズは追加後にファイルを直接編集
3. `data-slot` 属性を維持（デバッグ・テスト用）

### Tailwind 規律

- ユーティリティクラスは **1要素あたり最大10-12個**。超える場合はコンポーネント抽出
- `@apply` は非推奨 → 明示的な CSS プロパティまたはコンポーネント化で対応
- 条件付きスタイリングは `cn()` + CVA variants で管理（インライン三項演算子の乱用禁止）
- セマンティックなトークン名を使用: `text-primary`, `bg-muted`（`text-gray-500` 等の数値スケール直接指定より優先）

### LP・ページテンプレート戦略

新規 LP はゼロから作らない。**セクション単位のテンプレートを組み合わせて構成する。**

基本セクションテンプレート（順次整備）:
1. **Hero** — メインビジュアル + キャッチコピー + CTA
2. **Features** — 特徴・メリットのグリッド表示
3. **Testimonials** — お客様の声・レビュー
4. **CTA** — コンバージョン誘導ブロック
5. **FAQ** — よくある質問のアコーディオン

各テンプレートは `@theme` トークン + shadcn/ui コンポーネントで構成し、プロパティ（テキスト・画像・色）を差し替えるだけで新 LP を生成できる構造にする。

### 導入済みツール

| ツール | 目的 | 状態 |
|--------|------|------|
| Storybook | コンポーネントカタログ（59コンポーネント + トークン可視化） | ✅ 稼働中 |
| Style Dictionary | tokens/base.json → CSS変数 自動生成 | ✅ 稼働中 |
| Chromatic | Visual Regression 自動検知 | ✅ 設定済み |
| Figma Variable Rebinder | Code → Figma トークン同期プラグイン | ✅ 作成済み |
| Figma Variable Exporter | Figma → Code トークン書き出しプラグイン | ✅ 作成済み |

### デザインシステム管理スキル

| スキル | ファイル | 用途 |
|--------|---------|------|
| design-tokens | `.claude/skills/design-tokens.md` | トークンの編集・ビルド・検証ルール |
| figma-sync | `.claude/skills/figma-sync.md` | Figma ↔ コード同期手順 |
| component-catalog | `.claude/skills/component-catalog.md` | コンポーネント管理・追加手順 |
| visual-qa | `.claude/skills/visual-qa.md` | ビジュアル品質管理チェックリスト |

### デザインシステム管理コマンド

```bash
pnpm build:tokens        # トークンビルド（base.json → CSS変数）
pnpm validate:tokens     # トークンの整合性チェック
pnpm diff:tokens         # トークン変更の差分表示
pnpm audit:components    # コンポーネント使用状況レポート
pnpm sync:figma-read     # Figma API でファイル情報読み取り
pnpm storybook           # Storybook dev server (port 6006)
pnpm chromatic           # ビジュアルリグレッションテスト
```

## Figma 反映の忠実度ゲート（必須）

> **適用範囲**: 本リポ（elxea-web-app）で「Figma のデザインをコードに反映する」あらゆるタスク。触る全エージェントに自動適用される。将来的に他リポへ横展開可。
> **背景**: 目視検証（スクリーンショット照合）だけで数値差分がすり抜け、見出しサイズ 44px→32px・コンテナ幅 1232px→836px 等の乖離が本番反映された（2026-07-11 の教訓）。以降、下記ゲートを「一回きりでなく毎回必ず通る関門」として恒久化する。

**Figma→コード反映タスクの完了条件（必須・省略不可）。1 つでも欠けたら未完了として扱う。**

1. **数値対比表を EVIDENCE として提出（対象ページごと）** — 「Figma 実測値 vs 実画面 `getComputedStyle` 実測値」の対比表を必ず添付する。対比項目: `font-size` / `line-height` / `letter-spacing` / `font-weight` / コンテナ幅 / grid 列数・gap / 節余白（section padding/margin）/ 色 hex。
2. **全差分を 3 分類する。記録なき差分＝欠陥として扱う** —
   - **【仕様】** 承認済み差分（出典リンク必須）
   - **【粗】** 修正必須の乖離
   - **【要判断】** オーナー判断待ち
   （分類・記録されていない差分が 1 つでもあれば欠陥とみなす）
3. **スクリーンショット目視のみの検証は不合格** — 目視は構造一致しか担保できず数値差分をすり抜ける（実例: 44px→32px・1232px→836px を見逃した 2026-07-11）。必ず `getComputedStyle` の実測値で照合する。
4. **マージ前に別エージェントの忠実度監査 Pass を必須とする** — 実装者とは別のエージェントが数値照合（skill: `figma-implementation-fidelity-audit` 相当）を行い、Pass しない限りマージしない。実装者の自己申告のみでの完了は不可。
5. **承認済み仕様差分の正本一覧（監査の誤検出防止）** — 下表を「Figma と意図的に異なる承認済み仕様」の正本として登録する。監査はこの一覧に載る差分を【仕様】として扱い、誤って【粗】と判定しない。

   | 項目 | 承認済み仕様 | 出典 / 備考 |
   |---|---|---|
   | フォント | **コードが正**（`--font-sans` / `--font-heading`） | `app/globals.css` `@theme`。Figma 側フォントとの差分は仕様 |
   | ProductGrid 列数 | **3 列が正** | 承認済みレイアウト仕様 |
   | 写真ヒーロー | **コード実装が正** | 承認済みヒーロー構成 |

   ※本一覧に追加・変更する場合は Decision Log に記録してから反映する（記録なき仕様追加は認めない）。

## React / Next.js ベストプラクティス（Vercel Engineering 準拠）

コードの作成・レビュー・リファクタリング時に以下を常に適用する。出典: vercel-labs/agent-skills (MIT)

### CRITICAL: ウォーターフォール排除
- `await` は実際に使う分岐まで遅延させる
- 独立した非同期処理は `Promise.all()` で並列化
- API Routes でも promise を早期開始、await は最後
- `<Suspense>` 境界でストリーミング配信

### CRITICAL: バンドルサイズ最適化
- バレルファイル（index.ts）経由の import 禁止 → 直接 import
- 重いコンポーネントは `next/dynamic` で遅延読み込み
- アナリティクス等の非クリティカルライブラリはハイドレーション後に読み込み
- hover/focus 時に `preload` で体感速度向上

### HIGH: サーバーサイドパフォーマンス
- Server Actions にも認証チェック必須
- `React.cache()` でリクエスト内の重複排除
- RSC props で渡すデータは最小限にシリアライズ
- 静的 I/O（フォント、ロゴ）はモジュールレベルに巻き上げ
- `after()` で非ブロッキング処理

### MEDIUM: Re-render 最適化
- コールバックでのみ使う state は subscribe しない
- 高コスト処理は `React.memo` でラップ
- デフォルト値の非プリミティブ props は巻き上げ
- 派生 state は `useEffect` ではなくレンダー中に計算
- `startTransition` で非緊急更新を遅延

### MEDIUM: レンダリングパフォーマンス
- SVG アニメーションは `<g>` ラッパーに適用
- 長いリスト（50+）は `content-visibility: auto` または仮想化
- 条件付きレンダリングは `&&` ではなく三項演算子
- 静的 JSX はコンポーネント外に抽出

## Web UI ガイドライン（Vercel Web Interface Guidelines 準拠）

### アクセシビリティ
- アイコンのみのボタンには `aria-label` 必須
- フォームコントロールに `<label>` または `aria-label`
- インタラクティブ要素にはキーボードハンドラ（`onKeyDown`/`onKeyUp`）
- アクションには `<button>`、ナビゲーションには `<a>`/`<Link>`（`<div onClick>` 禁止）
- 画像に `alt` テキスト（装飾画像は `alt=""`）
- 見出しは階層的（`<h1>`〜`<h6>`）、skip link 追加
- セマンティック HTML 優先、ARIA は補助

### フォーム
- `autocomplete` と正しい `type`/`inputmode` 設定
- ペースト禁止（`onPaste` + `preventDefault`）は NG
- 送信ボタンはリクエスト開始まで有効、処理中はスピナー表示
- エラーはフィールド横にインライン表示、送信時は最初のエラーにフォーカス
- 未保存の変更がある場合はナビゲーション前に警告

### パフォーマンス
- `<img>` に `width`/`height` 明示（CLS 防止）
- ファーストビュー外の画像は `loading="lazy"`
- レンダー中のレイアウト読み取り（`getBoundingClientRect` 等）禁止
- CDN/アセットドメインに `<link rel="preconnect">`
- フォントは `<link rel="preload">` + `font-display: swap`

### アニメーション
- `prefers-reduced-motion` 対応必須
- `transform`/`opacity` のみアニメーション（コンポジター対応）
- `transition: all` 禁止 → プロパティ明示

### ダークモード・テーマ
- `color-scheme: dark` を `<html>` に設定
- `<meta name="theme-color">` をページ背景色に合わせる

### ナビゲーション・状態
- URL にフィルター・タブ・ページネーション等の状態を反映
- リンクは `<a>`/`<Link>`（Cmd+Click、中クリック対応）
- 破壊的操作は確認モーダルまたは Undo — 即時実行禁止

### アンチパターン（検出したら修正）
- `user-scalable=no` / `maximum-scale=1`（ズーム無効化）
- `outline-none` に focus-visible 代替なし
- `<div>`/`<span>` にクリックハンドラ（`<button>` を使う）
- ラベルなしのフォーム入力
- 寸法なしの画像
- ハードコードされた日付/数値フォーマット（`Intl.*` を使う）

## コード変更の品質ルール

一括置換・リファクタリング・デザインシステム移行など、広範なコード変更を行う場合は以下を厳守する。

### 1. 変更前：スコープの全件列挙
- 変更対象パターンを grep で洗い出し、該当ファイル・行数を一覧化してから着手する
- 「見つけた分だけ直す」ではなく「全量を把握してから着手する」
- 関連パターンも網羅する（例：`charcoal` を直すなら `cream`, `surface`, `light`, `error` 等も同時に列挙）

### 2. 変更後：残存ゼロの機械的検証
- 一括置換の後、同じパターン + 関連パターンで grep → `No matches found` を確認してから完了報告
- 二重置換（例：`text-muted-foreground-foreground`）などの副作用も検索対象に含める
- パターンマッチだけでなく「未変換ファイルの洗い出し」も行う（例：移行作業なら、移行対象の全ファイルをリストアップし、各ファイルが変換済みか確認する）

### 3. ビルド通過を完了の必須条件にする
- `pnpm build`（またはプロジェクトのビルドコマンド）が成功しない限り「完了」と報告しない

### 4. 「完全に」「すべて」「一つも残さず」は最高警戒レベル
- この種の指示を受けたら、部分対応ではなく全量対応
- 確認も二重に行う（パターン検索 + ビルド）

### 5. 完了報告時に検証結果を添える
- 「修正しました」だけではなく、grep 結果（残存ゼロ）とビルド成功のエビデンスを必ず添える
