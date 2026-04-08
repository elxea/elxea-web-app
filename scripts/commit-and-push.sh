#!/bin/bash
set -e

cd /vercel/share/v0-project

# Git設定
git config user.name "v0[bot]"
git config user.email "v0[bot]@users.noreply.github.com"

# 変更をステージング
git add .

# コミット
git commit -m "デザイン調整: TEALEAVESを参考にレイアウト改善

- オーバーレイ用デザイントークン追加（overlay, overlay-foreground等）
- トップページ: ヒーロー90vh、中央揃えセクション、ホバー改善
- Aboutページ: 60vhヒーロー、中央揃えレイアウト
- 商品リストページ: Collectionラベル追加、グリッド間隔拡大
- 商品詳細ページ: 正方形画像ギャラリー、余白拡大
- 全てのハードコード色をトークンに置き換え

Co-authored-by: v0[bot] <v0[bot]@users.noreply.github.com>"

# プッシュ
git push origin HEAD

echo "✅ 変更をプッシュしました"
