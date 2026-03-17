# Vercel Agent Skills 調査

調査日: 2026-03-09

## 概要

Vercel の **Agent Skills** は、AIコーディングエージェント（Claude Code, Cursor, GitHub Copilot 等 18+対応）に特定のスキル・ルールを追加するパッケージ。`npx skills add <repo>` でインストールすると、AGENTS.md にルールが追加される。

- 公式サイト: https://skills.sh
- ドキュメント: https://vercel.com/docs/agent-resources/skills
- GitHub: https://github.com/vercel-labs/agent-skills

## インストール方法

```bash
# 特定のスキルをインストール
npx skills add <owner/repo> --skill <skill-name>

# リポジトリ内の全スキルをインストール
npx skills add <owner/repo>

# スキルを検索
npx skills find <query>
```

## 公式スキル（vercel-labs）

### vercel-labs/agent-skills

| スキル名 | インストール数 | 内容 |
|----------|------------|------|
| **web-design-guidelines** | 145.1K | UI コード監査。100+ ルール（a11y, パフォーマンス, UX, ダークモード, i18n, タイポグラフィ, セマンティックHTML, キーボードナビ, フォーカス管理, フォーム, アニメーション, 画像最適化, レイアウト, タッチ操作等） |
| **react-best-practices** | — | React/Next.js パフォーマンス最適化。40+ ルール。8つの優先カテゴリ: waterfall排除, バンドル最適化, サーバーサイドパフォーマンス, クライアントサイドデータ取得, 再レンダリング最適化, レンダリングパフォーマンス, JS マイクロ最適化 |
| **composition-patterns** | — | React コンポーネント設計パターン。boolean prop の増殖防止（compound components）、状態管理最適化、内部構成の柔軟性、prop drilling 回避 |
| **vercel-deploy-claimable** | — | Vercel へのデプロイ自動化。40+ フレームワーク自動検出、プレビューURL生成 |
| **react-native-guidelines** | — | モバイル開発。16ルール（FlashList, メモ化, レイアウト, Reanimated, expo-image, 状態管理, monorepo, iOS/Android固有パターン） |

```bash
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
npx skills add vercel-labs/agent-skills --skill react-best-practices
npx skills add vercel-labs/agent-skills --skill composition-patterns
```

### vercel-labs/next-skills

| スキル名 | 種類 | 内容 |
|----------|------|------|
| **next-best-practices** | Background | Next.js コア知識。19トピック: ファイル規約, Server/Client境界, データ取得/ミューテーション, 非同期API, ルートハンドラ, メタデータ, Image/Font最適化, エラーハンドリング等 |
| **next-upgrade** | User-invocable | Next.js バージョンアップグレードガイド（公式マイグレーションドキュメント準拠） |
| **next-cache-components** | User-invocable | Next.js 16 キャッシュ機能（`'use cache'` ディレクティブ, cache profiles, `cacheLife()`, `cacheTag()` 等） |

```bash
npx skills add vercel-labs/next-skills
```

## コミュニティスキル（デザイン関連・人気順）

| スキル名 | 作者 | インストール数 | 内容 |
|----------|------|------------|------|
| **frontend-design** | anthropics/skills | 133.1K | フロントエンドデザイン原則 |
| **sleek-design-mobile-apps** | sleekdotdesign/agent-skills | 82.8K | モバイルアプリデザイン |
| **canvas-design** | anthropics/skills | 15.8K | ビジュアル/グラフィックデザイン |
| **tailwind-design-system** | wshobson/agents | 15.7K | Tailwind CSS デザインシステム構築 |
| **responsive-design** | supercent-io/skills-template | 10.1K | レスポンシブデザインパターン |
| **interface-design** | dammyjay93/interface-design | 7.3K | UI デザイン |

## elxea-developer への推奨

現在の技術スタック（Next.js 15 + Tailwind CSS 4 + React 19）を踏まえた優先度:

1. **web-design-guidelines** — a11y/UX レビューに直結。100+ ルールで UI 品質向上
2. **react-best-practices** — パフォーマンスチューニング（現在 PS 99、更に改善余地を発見可能）
3. **next-best-practices** — Next.js 15 ベストプラクティス
4. **tailwind-design-system** — Tailwind CSS デザインシステム構築

## 参考リンク

- [Vercel Agent Skills Docs](https://vercel.com/docs/agent-resources/skills)
- [vercel-labs/agent-skills (GitHub)](https://github.com/vercel-labs/agent-skills)
- [vercel-labs/next-skills (GitHub)](https://github.com/vercel-labs/next-skills)
- [skills.sh Directory](https://skills.sh)
- [Introducing Skills - Vercel Changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)
- [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
