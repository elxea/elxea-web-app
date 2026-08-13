# elxea Web App — プロジェクト技術仕様

elxea EC サイト（Next.js ヘッドレスコマース）のプロジェクト固有ルール。

エージェント定義（責務・権限・Devlog・制約）は `elxea-developer/CLAUDE.md` を参照。

## Gitルール（厳守）

- **作業はmainから切った短命トピックブランチで行う**（`feat/*` / `fix/*` / `chore/*` / `design/*` / `docs/*`）。作業前に必ず `git checkout main && git pull` してから切る
- **長命ブランチに居座らない**。1タスク = 1ブランチで、マージされたら捨てる。`developer` ブランチは歴史的遺物であり現行の作業先ではない（2026-08-07時点でmainの履歴に含まれていない）
- mainへの直接pushは禁止。マージはPR経由でCI全PASS後のみ
- **push前に `pnpm lint` / `pnpm typecheck` / `pnpm test` が通ること**。これはpre-commitのpre-pushフックで機械強制される（下記「ローカル品質ゲート」）
- コミットメッセージはconventional commitsに従う（feat:, fix:, ci:, test:, docs:, chore:）

### マージゲート（運用強制・3行）

- **mainへのマージはCIが緑になったことをBossが確認してから行う。** 赤・未実行のままマージしない
- **branch protectionは張れない**（無料プランでrequired status checksが有料）ため、CIは検査と可視化までで、**マージを止めるのは運用のみ**
- 確認は `gh run list --branch <branch> --limit 5` で当該コミットのconclusionが `success` であること。詳細は `docs/ci-gates.md`

### ローカル品質ゲート（pre-push・必須）

本リポはGitHub / Vercel無料プランのためbranch protection（required status checks）を張れない。壊れたコードがmainに入るのを止める唯一の機械強制がローカルのpre-pushフックなので、**clone直後に必ず入れる**。

```bash
pre-commit install --hook-type pre-commit --hook-type pre-push
```

- pre-commit stage: gitleaks / shellcheck / 空白・改行・JSON・YAML整合（高速）
- **pre-push stage: `pnpm lint` + `pnpm typecheck` + `pnpm test`（これが落ちるとpushできない）**
- 定義は `.pre-commit-config.yaml`。手動実行は `pre-commit run --hook-stage pre-push -a`
- `--no-verify` での回避は禁止

### 使い捨てスクリプトの置き場

計測・スクショ採取などの一回きりの `.mjs` / `.ts` は**リポジトリ直下に置かない**。`scripts/scratch/`（gitignore対象・ESLint対象外）に置く。直下に散らかすと、次のブランチ切替時に「消していいのか分からない未追跡ファイル」として残り、作業ツリーが動かせなくなる（2026-08-07に実際に13本が滞留した）。

## アーキテクチャ

実測値（2026-08-07 / `node_modules` の実バージョン）。バージョンを書き換えるときは推測せず実測すること。

- Runtime: Next.js 16.2.1 + React 19.2.4 + TypeScript 5.9.3（App Router）
- Styling: Tailwind CSS v4.2.1 + shadcn/ui（new-york）+ Radix UI + CVA
- CMS: Sanity.io（コンテンツ）+ Notion（タスク・運用）
- EC: Shopify Storefront API（ヘッドレス）
- Auth/DB: Firebase（Firestore + Auth）
- Deploy: Vercel
- i18n: next-intl（日本語 primary）
- Package Manager: pnpm

## デザインシステム方針

> **共通業務フロー**: デザイン提案・制作の共通フロー（2 モード / DS 準拠 / トークン束縛 / 二層チェック / 成果物台帳）は全プロジェクト共通の `design-workflow` skill を正本とする（詳細 = Design Ops Spec）。本節はプロジェクト固有の DS 差分を述べる。

### 原則: SoTはFigma（全テンプレート共通）

**デザインシステムのSource of Truth (SoT) はFigma。コードは追従側**（Setaka宣言2026-08-08）。

以前ここには「Critical 2テンプレートだけFigma = SoT、他テンプレートはCode = SoT」という段階移行の表を置いていたが、2026-08-08の宣言で**全テンプレート一律Figma = SoT** に確定したため撤去した。テンプレートごとにSoTが違う状態はもう無い。

| 対象 | SoT | 運用方針 |
|---|---|---|
| 全テンプレート | **Figma = SoT** | Figmaの変数・コンポーネントを正規定義とし、コードはそれに追従する。トークン値の写し先は `tokens/base.json`（→「Design Tokenアーキテクチャ」の序列表） |

> **未解決の不整合（着手前に確認すること）**: `scripts/design-system/design-kit.manual.json` の `value_sot` は旧方針のまま「値の正本はコード。Figmaは鏡。数値が食い違ったらコードを採用」と宣言している。これは単なる説明文ではなく**食い違いが起きたときにどちらを採るかの判定モデル**なので、本タスクでは書き換えていない（判定を反転させるとconflictsの扱いが変わるため、Decision Logでの決定が要る）。design-kitを根拠に「コードが正」と結論しないこと。

関連ドキュメント:
- dogfood Spec: https://www.notion.so/36970c9d064c8166b31ef4be3b60a8c5
- Decision Log: https://www.notion.so/36970c9d064c818ab8e9f9a16b37e2a1

### Design Tokenアーキテクチャ

**トークンの正本はFigma。コードはそれに追従する**（Setaka宣言2026-08-08）。値がどこから来てどこへ流れるかを、上流から順に固定する。

| 序列 | 実体 | 役割 | 編集してよいか |
|---|---|---|---|
| 1. 正本 | Figma Variables（ファイルキー `AWLnI0XF07e8rScuxPYPc7`） | トークン値の唯一の正解 | Figma上で編集する |
| 2. 写し | `tokens/base.json`（+ `tokens/overrides/cjk.json`） | Figma値をコードへ写したW3C DTCG形式のソース | Figmaに合わせて編集する。**コード側でトークンを足す/変えるならここ** |
| 3. 生成物 | `dist/tokens.css` / `dist/tokens-cjk.css` | Style Dictionaryの出力。`@theme { ... }` / `:lang(ja) { ... }` | **手で編集しない**（gitignore対象・`pnpm build:tokens` で毎回再生成される） |
| 4. 消費 | `app/globals.css` | 3を `@import` して読み込むだけ。`@theme` ブロック自体はここには無い | トークン定義は書かない |

流れ: **Figma → `tokens/base.json` → `pnpm build:tokens`（`sd.config.mjs`）→ `dist/tokens.css` → `app/globals.css` が `@import`**。
`pnpm build` は `node sd.config.mjs && next build` なので、ビルドすれば必ず再生成される。

3層モデル（W3C Design Tokens標準準拠）:

| 層 | 例 | 定義場所 |
|---|---|---|
| Core（生の値） | `oklch(0.205 0 0)` | `tokens/base.json` → 生成された `@theme` 内のCSS変数 |
| Semantic（用途別） | `--color-primary`, `--color-muted` | 同上（`color.semantic.*` は生成時に `semantic` が落ちて `--color-*` になる） |
| Component（適用値） | CVA variants内のTailwindクラス | 各 `components/ui/*.tsx` |

ルール:
- **生の値（HEX/OKLCH/px）をコンポーネント内に直書き禁止** → 必ずトークン経由。ESLint `elxea-tokens/no-raw-colors` がerrorで機械強制（既存違反は `eslint-suppressions.json` で凍結・新規は通らない）
- **`bg-[#xxx]` 等のarbitrary valueは原則禁止** → トークンが足りなければ `tokens/base.json` に追加 → `pnpm build:tokens` してから使う
- 色はOKLCHカラースペースで統一（知覚的均一性）
- フォントは `--typography-family-sans`（本文）/ `--typography-family-heading`（見出し）/ `--typography-family-secondary` / `--typography-family-mono` / `--typography-family-special`。**`--font-sans` / `--font-heading` という変数は存在しない**（過去のCLAUDE.md記述の誤り。2026-08-07訂正）

> **`tokens/elxea-custom.json` は削除済み（2026-08-14）**。同ファイルは `sd.config.mjs` の `source` に入っておらず読むコードが0件の死にファイルで、値（darkパレット一式・低不透明度shadow等）が実装値だと誤読される事故を複数回起こしたため除去した。**トークンの正本は `tokens/base.json`**（+ `tokens/overrides/cjk.json`）。未使用の重複configだった `tokens/config.mjs` も同時に削除（実効は `sd.config.mjs`）。darkパレットの旧値が要るときはgit履歴 `c54335a` から復元できる。過去の監査記録（`scripts/design-system/design-kit.generated.json` の `conflicts[c-01]` / `[c-02]`、`docs/fidelity/*`）に残る `elxea-custom.json` 言及は当時の記録であり、現在のファイル構成ではない。

### 確定値ファイルの勘定（対外3本 + ビルド内部入力1本）

デザインの確定値がどのファイルに載っているかを、外から参照してよい3本だけに絞る。「4本目のSoTがある」と読める状態をなくすための勘定表。

| 位置づけ | ファイル | 役割 | 外から参照してよいか |
|---|---|---|---|
| 値 | `tokens/base.json`（+ `tokens/overrides/cjk.json`） | トークン値の写し（Figma正本の写し先）。値を知りたいときはここ | ○ |
| 索引 | `scripts/design-system/design-map.json` | どの値がどこで使われているかの索引 | ○ |
| 審判 | `scripts/design-system/design-kit.generated.json` | 実装とFigmaの食い違い（conflicts）・既知の穴（known_gaps）の判定結果 | ○ |
| ビルド内部入力 | `scripts/design-system/design-kit.manual.json` | 上記「審判」を組み立てるための人手注記の入力ファイル。**独立したSoTではない** | ×（generatedを見る） |

`design-kit.manual.json` の扱い（2026-08-07 QA判定 https://app.notion.com/p/3b570c9d064c8195b8b1c7da0ae6525c に準拠）:

- **物理削除しない**。`generate-design-kit.ts` / `validate-design-kit.ts` が必ず読むため、消すと `pnpm validate:design-kit` が即死しCI（`.github/workflows/ci.yml`）が落ちる。改名するなら `MANUAL_PATH` を同時に直す
- **generated側を手で書き換えない**。generatedはmanualをnon-clobberingマージして再生成されるビルド出力で、再生成結果とのバイト一致が検査される
- **人手編集は例外時のみ**。conflicts / known_gapsの注記を足す必要が出たときにmanualを編集し、`pnpm generate:design-kit` → `pnpm validate:design-kit` まで通してからコミットする。コード由来の値を人手で上書きするとマージ衝突でビルドが落ちる（それが設計）
- `value_sot` の判定モデル（食い違い時にコードとFigmaのどちらを採るか）の変更は**この勘定の話に含まれない**。反転させるにはDecision Logでの決定が要る（上記「未解決の不整合」参照）

### Figma正本ファイルとSoT方針

- **Figma正本ファイルキー = `AWLnI0XF07e8rScuxPYPc7`**（旧 `alDl0i3hZvRlqCxH9Li5Q4` は使用しない）。`scripts/design-system/sync-figma-read.ts` の `DEFAULT_FILE_KEY` および `.claude/skills/figma-sync.md` と一致させる。
- **SoT方針**: トークン値の正本は **Figma**。コードは追従側（`tokens/base.json` が写し、`dist/` が生成物）。過去にここへ記載していた「案B＝Codeが正本」は2026-08-08のSetaka宣言で反転済み。
- **Code Connectは現状不採用**: Figma Organizationプラン必須のため、当面は採用しない（コード→Figmaの同期はVariable Rebinderプラグインで運用）。

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
- **`@apply` は原則禁止（例外あり）** — コンポーネント（`.tsx`）やページ単位のスタイルを `@apply` で組まない。明示的なCSSプロパティまたはCVA variantsで対応する。
  **唯一の例外は `app/globals.css` の `@layer base` に置く全域デフォルト**。要素セレクタ（`button` / `a` / `[data-slot="button"]`）やレイアウトユーティリティ（`.section-narrow` / `.section-wide` / `.section-full`）のように「全ページ共通の素の挙動」を定義する箇所に限り許可する。2026-08-07実測で該当は8箇所、すべて `app/globals.css` の `@layer base` 内。
  例外を増やす場合は `app/globals.css` の `@layer base` 内に置き、それ以外のファイルには書かない
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

### コンポーネントカタログの呼び方（対外名称）

- **対外名称 = 「elxea Design System カタログ」**。内部名（script 名 / CI job / パス）は `design-catalog`
- **roji 固有名は使わない**。このカタログは roji だけのものではなく elxea 全体の共通基盤だから
- **ツール実体は Storybook のまま**（載せ替えはしない）。「Storybook」は実装手段の名前であって、対外的な呼び名ではない
- 実行: `pnpm design-catalog`（dev） / `pnpm build:design-catalog`（静的ビルド）。`build-storybook` は Chromatic が既定で探すスクリプト名なので別名として存置している
- ブランド表記の定義は `.storybook/manager.ts`（`brandTitle`）

### 導入済みツール

| ツール | 目的 | 状態 |
|--------|------|------|
| elxea Design System カタログ（内部名 design-catalog / 実体は Storybook） | コンポーネントカタログ（`components/ui` の61部品 + トークン可視化。うちstory済58） | ✅ 稼働中 |
| Style Dictionary | `tokens/base.json` → `dist/tokens.css`（`@theme`）自動生成 | ✅ 稼働中 |
| Chromatic | Visual Regression 自動検知 | ✅ 設定済み |
| Figma Variable Rebinder | Code → Figma トークン同期プラグイン | ✅ 作成済み |
| Figma Variable Exporter | Figma → Code トークン書き出しプラグイン | ✅ 作成済み |

### デザインシステム管理スキル

| スキル | ファイル | 用途 |
|--------|---------|------|
| **dev-workflow** | `.claude/skills/dev-workflow.md` | **実装工程の手順カード（Step 0-8 / 完了定義5点）。実装タスクに着手する前に必ず読む。正本 = roji Dev Ops Spec v1** |
| design-tokens | `.claude/skills/design-tokens.md` | トークンの編集・ビルド・検証ルール |
| figma-sync | `.claude/skills/figma-sync.md` | Figma ↔ コード同期手順 |
| component-catalog | `.claude/skills/component-catalog.md` | コンポーネント管理・追加手順 |
| visual-qa | `.claude/skills/visual-qa.md` | ビジュアル品質管理チェックリスト |

### デザインシステム管理コマンド

```bash
pnpm lint                # ESLint（--max-warnings 0）
pnpm typecheck           # 型チェック（stale .next/types をクリア → next typegen → tsc --noEmit）
pnpm test                # unit test（vitest run）
pnpm build               # トークン再生成 + 本番ビルド
pnpm build:tokens        # トークンビルド（base.json → dist/tokens.css）
pnpm validate:tokens     # トークンの整合性チェック
pnpm diff:tokens         # トークン変更の差分表示
pnpm audit:components    # コンポーネント使用状況レポート
pnpm sync:figma-read     # Figma API でファイル情報読み取り
pnpm design-catalog      # elxea Design System カタログ dev server (port 6006)
pnpm build:design-catalog # 同・静的ビルド（`build-storybook` は Chromatic 既定名のため別名で存置）
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
   | フォント | **コードが正**（`--typography-family-sans` / `--typography-family-heading` / `-secondary` / `-mono` / `-special`） | 実体は `tokens/base.json` → `dist/tokens.css` の `@theme`。Adobe Fonts kit `fwg7gtf` を `layout.tsx` のJS embedで読み込む。Figma側フォントとの差分は仕様 |
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
- `pnpm build` が成功しない限り「完了」と報告しない
- **型チェックは必ず `pnpm typecheck` 経由で行う**（`tsc --noEmit` を直接叩かない）。`tsconfig.json` の `include` に `.next/types/**/*.ts` が入っているため、ブランチ切替後などに残った古い `.next/types` が「実在しないルートの型エラー」を幽霊として出す。`pnpm typecheck` は `.next/types` / `.next/dev/types` / `tsconfig.tsbuildinfo` を消してから `next typegen` で型を作り直すので、この幽霊が原理的に出ない
- 完了前に通すべき4本: `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`（前3本はpre-pushフックでも機械強制される）

### 4. 「完全に」「すべて」「一つも残さず」は最高警戒レベル
- この種の指示を受けたら、部分対応ではなく全量対応
- 確認も二重に行う（パターン検索 + ビルド）

### 5. 完了報告時に検証結果を添える
- 「修正しました」だけではなく、grep 結果（残存ゼロ）とビルド成功のエビデンスを必ず添える
