# Visual QA スキル

デザインシステムのビジュアル品質管理に使う。

## ツール

| ツール | 用途 | コマンド |
|--------|------|---------|
| Storybook | コンポーネントの視覚確認 | `pnpm storybook` |
| Chromatic | スクリーンショット比較・リグレッション検出 | `pnpm chromatic` |
| Active Components | 使用中コンポーネントの一括確認 | Storybook → elxea/Active Components |

## Storybook での確認

### 起動
```bash
pnpm storybook    # http://localhost:6006
```

### 確認ポイント

#### Active Components ページ（最重要）
サイト全体の見た目に直結する10コンポーネント:
- Button（全バリアント + サイズ）
- Card（通常 + サブスクリプション例）
- Badge（全バリアント）
- Input + Label（テキスト、メール、検索、disabled）
- Separator（水平 + 垂直）
- Dialog（画像プレビュー例）
- Sheet（モバイルメニュー + カート）
- Skeleton（ローディング状態）
- Toast/Sonner（通知バリアント）

#### Token Stories
- `tokens/Colors` — カラーパレット一覧
- `tokens/Typography` — フォント・サイズ・ウェイト
- `tokens/Spacing` — スペーシングスケール
- `tokens/Radius` — ボーダーラディウススケール

## Chromatic（ビジュアルリグレッション）

### 実行
```bash
pnpm chromatic                        # 全 stories をスクリーンショット
pnpm chromatic --exit-zero-on-changes # 差分があっても exit 0
```

### フロー
1. PR 作成 → Chromatic が自動実行
2. 各 story のスクリーンショットを前回と比較
3. 差分があれば Chromatic UI でレビュー
4. Accept / Deny で承認管理

### 設定
- `@chromatic-com/storybook` がアドオンとして設定済み
- `.storybook/main.ts` に統合

## トークン変更時の QA チェックリスト

### 色の変更
- [ ] Active Components の全コンポーネントで色が正しく適用されてるか
- [ ] hover / focus / disabled 状態でコントラスト比が十分か
- [ ] ダークモード（`.dark` クラス）でも問題ないか

### タイポグラフィの変更
- [ ] 見出し（h1-h6）のサイズ・ウェイトが意図通りか
- [ ] 本文テキスト（body）の可読性が確保されてるか
- [ ] 日本語表示（`:lang(ja)`）で行間・字間が適切か

### スペーシングの変更
- [ ] Card の padding が十分か
- [ ] Button のサイズが操作しやすいか
- [ ] Input フィールドの高さが適切か

### ボーダーラディウスの変更
- [ ] Card / Button / Input で角丸が統一されてるか
- [ ] Badge の角丸が過剰でないか

## ブラウザでの実機確認

Storybook だけでは確認できない項目:

### レスポンシブ
- モバイル（375px）: Sheet のメニュー、カートが正常に開くか
- タブレット（768px）: Card のグリッドレイアウト
- デスクトップ（1280px+）: 最大幅の制約

### インタラクション
- Dialog の開閉アニメーション
- Sheet のスライドイン/アウト
- Toast の表示・自動消去
- Button の hover/active 状態遷移

### パフォーマンス
- Skeleton → 実コンテンツの切り替えが自然か
- フォント読み込み（Adobe Fonts）で FOUT が発生しないか

## CI 統合（将来）

```yaml
# GitHub Actions（検討中）
- pnpm validate:tokens    # トークンの整合性
- pnpm build:tokens       # CSS 生成
- pnpm build-storybook    # Storybook ビルド
- pnpm chromatic          # ビジュアルリグレッション
```
