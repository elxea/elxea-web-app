# Shopify 注文確認メール カスタマイズガイド

## 設定場所

Shopify Admin > 設定 (Settings) > 通知 (Notifications) > 注文確認 (Order confirmation)

URL: `https://admin.shopify.com/store/elxea/settings/notifications`

## elxea ブランド設定

### カラーコード
- プライマリ: `#1A1A1A`（ダークブラック）
- アクセント: `#4A7C59`（茶葉グリーン）
- 背景: `#FAFAF8`（オフホワイト）
- テキスト: `#333333`

### フォント
- 見出し: Georgia, serif
- 本文: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

## ウィンドウとレイアウト設定

Shopify Admin の「通知のカスタマイズ」では以下を設定:

| 項目 | 推奨値 |
|------|--------|
| 背景色 | `#FAFAF8` |
| アクセントカラー | `#1A1A1A` |
| ボタン背景色 | `#1A1A1A` |
| ボタンテキスト色 | `#FFFFFF` |
| ロゴ | elxea ロゴ画像を Shopify にアップロード後 URL を設定 |

## メール本文 Liquid テンプレート（部分）

### ヘッダー挨拶文
```liquid
{% if customer %}
{{ customer.first_name }} 様、
{% else %}
お客様、
{% endif %}

この度はご注文いただき、誠にありがとうございます。
ご注文内容をご確認ください。
```

### フッター
```liquid
---
elxea（エルクシア）
日本茶専門ブランド

ご不明な点がございましたら、下記よりお気軽にお問い合わせください。
https://elxea.com/contact

© {{ "now" | date: "%Y" }} elxea. All rights reserved.
```

## 注意事項

- Liquid テンプレートを直接編集する場合は「コードを編集」をクリック
- テスト送信は「テストメールを送信」ボタンを使用
- 変更は即時反映されるため、必ずテスト送信で確認してから保存
- Shopify は標準で HTML メールを生成するため、過度な HTML カスタマイズは不要
