# Figma ↔ Code 同期スキル

Figma と elxea-web-app コードベース間のデザイントークン同期を行うときに使う。

## アーキテクチャ

```
Code（追従側 / 写し）           Figma（正本）
tokens/base.json  ──────→  Figma Variables
                  Rebinder プラグイン

tokens/base.json  ←──────  Figma Variables
                  Exporter プラグイン
```

**Figmaが正本**（Setaka宣言2026-08-08）。`tokens/base.json` はFigma値の写しで、コードはFigmaに追従する。
値が食い違ったら直す方向は常に「コードをFigmaに合わせる」。Rebinder（Code → Figma）は**写しを正本へ書き戻す用途では使わない** — Figmaで確定した値を機械的に反映する補助であり、実装都合でFigmaを書き換えないこと。

## ツール一覧

| ツール | 方向 | 場所 | 用途 |
|--------|------|------|------|
| Variable Rebinder | Code → Figma | `figma-plugins/variable-rebinder/` | コードのトークン値を Figma 変数にバインド |
| Variable Exporter | Figma → Code | `figma-plugins/variable-exporter/` | Figma 変数値を base.json 形式で書き出し |
| sync:figma-read | Read Only | `scripts/design-system/sync-figma-read.ts` | Figma API でファイル情報を読み取り |

## Figma API 設定

- **トークン**: `.env.local` の `FIGMA_PERSONAL_ACCESS_TOKEN`
- **ファイルキー**: `AWLnI0XF07e8rScuxPYPc7`（elxea Design System / 正本ファイル。旧 `alDl0i3hZvRlqCxH9Li5Q4` は使用しない）
- **チーム ID**: `1449034364656814551`（CIRCL）
- **有効期限**: 2026/6/17（90日、再発行が必要）
- **スコープ**: file_content:read, file_metadata:read, file_versions:read, library_assets:read, library_content:read, team_library_content:read

### API の制限（Free プラン）
- `file_variables:read/write` スコープは **Enterprise 限定**
- Variables の値を REST API で直接読み書きできない
- ファイル構造・スタイル・コンポーネント情報は読み取り可能

## ワークフロー

### 1. コードで調整 → Figma に反映（主フロー）

```
1. tokens/base.json を編集
2. pnpm build:tokens
3. Storybook で確認
4. commit & push
5. （必要時のみ）Figma で Rebinder プラグインを実行
```

### 2. Figma で調整 → コードに反映

```
1. Figma で Variables の値を視覚的に調整
2. Exporter プラグインを実行 → JSON がクリップボードにコピー
3. tokens/base.json に貼り付け（または差分マージ）
4. pnpm validate:tokens
5. pnpm build:tokens
6. Storybook で確認
7. commit & push
```

### 3. Figma ファイル情報の確認

```bash
# ファイル構造レポート
pnpm sync:figma-read

# JSON 形式で出力
pnpm sync:figma-read -- --json

# 別ファイルを指定
FIGMA_FILE_KEY=xxxxx pnpm sync:figma-read
```

## Figma プラグインの使い方

### Rebinder（Code → Figma）
1. Figma Desktop で対象ファイルを開く
2. Plugins → Development → Import plugin from manifest
3. `figma-plugins/variable-rebinder/manifest.json` を選択
4. プラグインを実行 → 変数バインディングが更新される

### Exporter（Figma → Code）
1. Figma Desktop で対象ファイルを開く
2. Plugins → Development → Import plugin from manifest
3. `figma-plugins/variable-exporter/manifest.json` を選択
4. プラグインを実行 → JSON がクリップボードにコピーされる
5. `tokens/base.json` に貼り付け

## elxea Variables コレクション

Figma 上に以下の9コレクションが存在:

| コレクション | 内容 |
|-------------|------|
| color | semantic + brand カラー |
| typography | family, size, weight, lineHeight, letterSpacing, style |
| spacing | 0-96 スケール |
| shape | radius, borderWidth |
| layout | grid, container, breakpoint |
| media | aspectRatio, imageSize |
| motion | duration, easing, delay |
| elevation | shadow, zIndex, opacity |
| component | button, input, card 等のサイズトークン |

## トークン再発行

API トークンは90日で期限切れになる。再発行手順:
1. https://www.figma.com → Settings → Security → Personal access tokens
2. Generate new token
3. Name: `elxea-sync`, Expiration: 90 days
4. Scopes: file_content:read, file_metadata:read, file_versions:read, library_assets:read, library_content:read, team_library_content:read
5. `.env.local` の `FIGMA_PERSONAL_ACCESS_TOKEN` を更新
