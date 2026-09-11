# elxea Customer Agent — 設計ドキュメント

## 1. コンセプト

LINE を起点とした AI カスタマーエージェント。顧客との 1:1 の関係を構築し、商品提案・購入後サポート・コンテンツ配信を統合的に行う。

**一言で**: 「elxea を熟知した、親しみやすいスタッフが LINE にいる」

### ゴール
- 新規顧客: 商品選びの相談 → 購入コンバージョン向上
- 既存顧客: 購入後フォロー + パーソナライズされたコンテンツ配信 → LTV 向上
- 運用: 人間オペレーターの負荷を減らしつつ、必要な時は確実にエスカレーション

### トーン
- 親しみやすい・カジュアル
- 知識豊富だけど押し付けない
- elxea / roji の世界観（生産者のストーリー、素材へのこだわり）を自然に伝える

---

## 2. チャネル戦略

| フェーズ | チャネル | 優先度 |
|---------|---------|--------|
| MVP | LINE 公式アカウント | 最優先 |
| Phase 2 | Web チャット（elxea サイト内） | 高 |
| Phase 3 | メール（トランザクション + ナーチャリング） | 中 |

**MVP は LINE に集中**。Web チャット・メールは同じ Agent Core を共有するため、チャネルアダプターの追加で対応可能。

---

## 3. 設計思想: Notion-Grounded AI

**核心原則: AI は Notion に書かれていることだけを話す。**

- AI が一般知識で勝手に回答することを禁止する
- すべてのナレッジは Notion に一元管理（商品情報、FAQ、コンテンツ、接客マニュアル）
- Notion にない情報を聞かれたら「確認して折り返します」→ エスカレーション
- これにより**ハルシネーション防止**と**ブランドコントロール**を両立

### ナレッジソースの整理

| 情報の種類 | ソース | 理由 |
|-----------|--------|------|
| 商品知識（説明、成分、使い方、おすすめ） | **Notion** | チームが書いた正確な情報のみ使う |
| 価格・バリアント | **Notion** | Shopify と同期 or 手動管理 |
| ブランド情報・FAQ・ポリシー | **Notion** | 公式回答のみ使う |
| 記事・生産者・イベント | **Notion** | コンテンツもナレッジとして統合 |
| 接客マニュアル・トーン定義 | **Notion** | エージェントの振る舞いを制御 |
| 顧客の購入履歴・注文状況 | **Shopify API** | 動的な個人データは API 参照が必須 |
| 顧客プロフィール・会話履歴 | **Supabase** | エージェント固有のデータ |

---

## 4. システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Channel Layer                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────┐               │
│  │ LINE     │  │ Web Chat     │  │ Email  │               │
│  │ Webhook  │  │ WebSocket    │  │ SMTP   │  (Phase 2,3)  │
│  └────┬─────┘  └──────┬───────┘  └───┬────┘               │
└───────┼────────────────┼──────────────┼────────────────────┘
        │                │              │
        ▼                ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Router                            │
│  - チャネル正規化（LINE/Web/Email → 統一フォーマット）        │
│  - 署名検証（LINE X-Line-Signature）                        │
│  - 重複排除（webhookEventId）                               │
│  - 即時 200 OK 返却 → 非同期処理                            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Core                               │
│  ┌──────────────────────────────────────────────┐          │
│  │  Claude API (tool_use)                       │          │
│  │  - System Prompt（ブランド人格 + グラウンディ  │          │
│  │    ングルール + NG 行動定義）                   │          │
│  │  - Conversation Memory                       │          │
│  │  - Tool Calls:                               │          │
│  │    ├─ search_knowledge   (Notion → Vector)   │          │
│  │    ├─ get_customer_info  (Shopify + CDP)     │          │
│  │    ├─ get_order_status   (Shopify)           │          │
│  │    ├─ escalate_to_human  (Escalation)        │          │
│  │    └─ create_cart_link   (Shopify)           │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
│  【グラウンディングルール】                                   │
│  1. 必ず search_knowledge で情報を取得してから回答            │
│  2. 取得した情報に基づく回答のみ許可                          │
│  3. 情報が見つからない場合 →「確認します」+ エスカレーション   │
│  4. 推測・補完・一般知識での回答は禁止                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Knowledge   │ │   Customer   │ │  Escalation  │
│   Layer      │ │   Data       │ │   System     │
│  (Notion)    │ │   Platform   │ │              │
│              │ │              │ │ - Slack 通知 │
│ Notion DB   │ │ - 統合       │ │ - 会話履歴   │
│   ↓ sync    │ │   プロフィール│ │   引き継ぎ   │
│ Vector Store │ │ - LINE ↔     │ │ - 対応状況   │
│ (pgvector)  │ │   Shopify ID │ │   管理       │
│              │ │ - 会話履歴   │ │              │
│              │ │ - 嗜好・属性 │ │              │
└──────────────┘ └──────────────┘ └──────────────┘

                        ┌──────────────┐
                        │  Proactive   │
                        │  Engine      │
                        │              │
                        │ - Notion     │
                        │   更新検知   │
                        │   → 配信     │
                        │ - セグメント │
                        │   ターゲティ │
                        │   ング       │
                        │ - スケジュー │
                        │   リング     │
                        └──────────────┘
```

---

## 5. コンポーネント詳細

### 5.1 Agent Core

Claude API の tool_use を活用。**すべての回答は必ず search_knowledge の結果に基づく。**

| Tool | 説明 | データソース |
|------|------|-------------|
| `search_knowledge` | ナレッジ検索（商品、FAQ、コンテンツ等すべて） | Notion → Vector Store |
| `get_customer_info` | 顧客の購入履歴・属性 | Shopify Admin API + CDP |
| `get_order_status` | 注文状況確認 | Shopify Admin API |
| `create_cart_link` | カートに商品追加した URL 生成 | Shopify Storefront API |
| `escalate_to_human` | 人間オペレーターに引き継ぎ | Escalation System |

**System Prompt 構成**:
```
1. グラウンディングルール（最重要）
   - 回答は必ず search_knowledge の結果に基づくこと
   - ナレッジにない情報は「確認して折り返します」と回答
   - 推測・補完・一般知識での回答は禁止
   - 引用元のナレッジを内部的にトラッキング

2. ブランド人格の定義（トーン、口調、NG ワード）

3. エスカレーション条件
   - ナレッジに該当情報がない場合
   - クレーム・返品・返金に関する内容
   - ユーザーが明示的に人と話したい場合
   - センシティブな話題

4. ツール使用ガイドライン（いつ何のツールを使うか）
```

### 5.2 Knowledge Layer（Notion 一元管理）

**Notion がすべてのナレッジの Single Source of Truth。**

#### Notion DB 構成案

```
📁 elxea Knowledge Base（Notion ワークスペース）
├── 🛍️ 商品 DB
│   ├── 商品名、説明、成分、使い方
│   ├── 価格、バリアント（サイズ / 香り等）
│   ├── おすすめの組み合わせ
│   ├── こんな人におすすめ（肌質、悩み、シーン）
│   ├── 画像 URL（Shopify CDN）
│   └── Shopify 商品 URL / ハンドル
│
├── ❓ FAQ DB
│   ├── 質問
│   ├── 回答
│   └── カテゴリ（配送、返品、支払い、商品全般）
│
├── 📝 コンテンツ DB
│   ├── 記事タイトル、本文
│   ├── 生産者プロフィール
│   ├── イベント情報
│   └── URL
│
├── 📖 ブランド情報
│   ├── ブランドストーリー
│   ├── ミッション・ビジョン
│   └── 返品ポリシー、送料ルール等
│
└── 🤖 接客マニュアル
    ├── トーン・口調ガイドライン
    ├── シーン別対応例
    └── NG ワード・NG 行動リスト
```

#### Notion → Vector Store 同期パイプライン

```
Notion ページ更新
  → Notion API でページ取得（ポーリング or Webhook 代替）
  → テキスト抽出 + チャンク分割
  → Embedding 生成（OpenAI text-embedding-3-small or Voyage）
  → Supabase pgvector に upsert
  → メタデータ付与（ソースDB、ページID、カテゴリ、更新日時）
```

**同期方式の選択肢**:
| 方式 | メリット | デメリット |
|------|---------|-----------|
| 定期ポーリング（5-15分間隔） | シンプル、Notion API のみ | リアルタイム性がやや低い |
| Notion Webhook（現状非公式） | リアルタイム | Notion の公式 Webhook は未成熟 |
| 手動トリガー（管理画面 or CLI） | 確実 | 運用負荷 |
| **推奨: 定期ポーリング + 手動トリガー併用** | バランス良い | — |

#### 検索の仕組み（RAG）

```
ユーザーの質問
  → Claude が search_knowledge ツールを呼び出す
  → クエリを Embedding に変換
  → pgvector で類似度検索（top-k = 5-10）
  → 取得したチャンクを Claude に渡す
  → Claude がチャンクの内容のみに基づいて回答を生成
```

**検索品質向上のテクニック**:
- Hybrid Search: ベクトル検索 + キーワード検索（BM25）の組み合わせ
- メタデータフィルタ: カテゴリ（商品/FAQ/コンテンツ）で絞り込み
- リランキング: 取得結果を関連度で再順位付け

### 5.3 Customer Data Platform (CDP)

**統合プロフィール**:

```
CustomerProfile {
  id: string                    // 内部 ID (ULID)
  line_user_id: string | null   // LINE UID
  shopify_customer_id: string | null
  email: string | null
  display_name: string

  // Shopify から同期
  purchase_history: Order[]
  total_spent: number
  order_count: number
  tags: string[]                // Shopify customer tags

  // エージェントが学習
  preferences: {
    skin_type: string | null
    interests: string[]         // ["オーガニック", "ギフト", "スキンケア"]
    favorite_products: string[]
  }

  // 行動データ
  last_interaction: timestamp
  conversation_count: number
  channel_preference: "line" | "web" | "email"
}
```

### 5.4 ID 紐付け（LINE ↔ Shopify）

**推奨方式: LIFF + メールマッチング のハイブリッド**

```
【フロー A: 友達追加時の自然な紐付け】

1. ユーザーが LINE 友達追加
2. ウェルカムメッセージで「会員連携するとお得」を案内
3. LIFF アプリ（LINE 内ブラウザ）で簡易フォーム表示
   - メールアドレス入力
   - (任意) Shopify ログイン
4. サーバー側:
   - メールで Shopify Customer を検索
   - マッチしたら line_user_id ↔ shopify_customer_id を保存
   - マッチしなければ「新規」として CDP に登録

【フロー B: 会話中の自然な紐付け】

1. ユーザーが「注文状況を教えて」等のリクエスト
2. エージェント: 「注文番号かメールアドレスを教えてもらえますか？」
3. メール or 注文番号で Shopify を検索
4. 確認後、紐付けを保存
```

**フロー A を推奨する理由**:
- Account Link API はフローが複雑でユーザー離脱リスクが高い
- LIFF はLINEアプリ内で完結するため UX が良い
- メールマッチングは Shopify の既存顧客データを活用できる
- フロー B は紐付け未完了ユーザーへのフォールバック

### 5.5 Proactive Engine（能動配信）

**トリガー: コンテンツ起点（Notion 更新）**

```
Notion でコンテンツ更新・公開
  → 同期パイプラインが検知
  → コンテンツの内容を分析（カテゴリ、関連商品、ターゲット属性）
  → CDP からマッチする顧客セグメントを抽出
  → Claude で顧客ごとにパーソナライズしたメッセージ生成
  → LINE Push API で配信
```

**配信ルール**:
- 同一ユーザーへの配信頻度制限（例: 週 2 回まで）
- 配信時間帯制限（9:00-21:00）
- ユーザーの配信停止リクエストを尊重
- LINE の無料メッセージ枠を考慮したバジェット管理

**セグメント例**:
| セグメント | 条件 | 配信例 |
|-----------|------|--------|
| スキンケア好き | preferences.interests に "スキンケア" | 新しいスキンケア記事 |
| ギフト購入者 | 過去にギフト商品を購入 | ギフトシーズン前の提案 |
| 休眠顧客 | 最終購入から 90 日以上 | 新商品 + 限定オファー |
| ヘビーユーザー | order_count >= 3 | VIP 先行案内 |

### 5.6 Escalation System

```
【エスカレーション条件】
1. ユーザーが明示的に「人と話したい」
2. クレーム・返品・返金に関する内容
3. AI が回答に自信がない（3 回連続で的外れな応答）
4. センシティブな話題（健康被害の訴え等）

【エスカレーションフロー】
1. エージェントが escalate_to_human ツールを呼び出す
2. Slack の #customer-support チャネルに通知
   - 顧客情報サマリー
   - 会話履歴（直近 10 メッセージ）
   - エスカレーション理由
3. LINE 側: 「担当者に引き継ぎました。少々お待ちください」
4. 人間オペレーターが Slack or 管理画面から LINE に返信
5. 対応完了後、エージェントに制御を戻す
```

---

## 6. 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| Runtime | Node.js (Next.js API Routes or Hono) | 既存 elxea サイトとの統合 |
| AI | Claude API (tool_use) | ツール呼び出しの品質、日本語能力 |
| Knowledge | **Notion** (API) → **Supabase pgvector** | 一元管理 + セマンティック検索 |
| Embedding | OpenAI text-embedding-3-small or Voyage | チャンクのベクトル化 |
| DB | Supabase (PostgreSQL + pgvector) | CDP、会話履歴、ベクトルストア統合 |
| Queue | Inngest / QStash / BullMQ | 非同期メッセージ処理 |
| LINE | LINE Messaging API | チャネルアダプター |
| EC | Shopify (既存) | 顧客データ・注文データのみ |
| Monitoring | Sentry + Langfuse | エラー追跡 + LLM 観測 |

### 技術選定の判断ポイント

**Notion を Knowledge Layer にする利点**
- チームメンバーが Notion で書く → AI が即座にそれを学ぶ、という自然なワークフロー
- エンジニアでなくてもナレッジを更新できる
- 構造化データ（DB）と非構造化データ（ページ）の両方を扱える
- ブランドコントロールが明確（Notion にあるもの = AI が言っていいこと）

**Notion の制約と対策**
- Notion API はレート制限あり（3 req/sec） → ポーリング間隔で調整
- リアルタイム Webhook が未成熟 → 定期ポーリング + 手動同期で代替
- 検索機能が弱い → pgvector でセマンティック検索を自前構築

**Supabase に統合する理由**
- pgvector: ベクトルストアを別サービスにしなくて済む
- PostgreSQL: CDP、会話履歴、ナレッジインデックスをすべて同一 DB に
- Row Level Security で顧客データ保護
- 無料枠あり

**Queue: なぜ必要か**
- LINE Webhook は即時 200 OK を返す必要がある（タイムアウト回避）
- Claude API 呼び出しは 2-10 秒かかる
- Reply Token は 30 秒で失効するため、Push API で返信する
- Queue がないと、Webhook の再送（リトライ）時に重複処理が発生する

---

## 7. LINE メッセージ設計

### リッチメニュー構成

```
┌──────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┐      │
│  │  商品を  │  注文    │  お問い  │      │
│  │  探す    │  確認    │  合わせ  │      │
│  ├──────────┼──────────┼──────────┤      │
│  │  おすすめ│  記事を  │  会員    │      │
│  │  診断    │  読む    │  連携    │      │
│  └──────────┴──────────┴──────────┘      │
└──────────────────────────────────────────┘
```

### メッセージタイプの使い分け

| シーン | メッセージタイプ | 例 |
|--------|----------------|-----|
| 通常の会話 | Text | テキスト応答 |
| 商品提案 | Flex Message (Carousel) | 商品カード 2-3 枚 |
| 記事紹介 | Flex Message (Bubble) | サムネ + タイトル + リンク |
| 選択肢の提示 | Quick Reply | 「スキンケア」「ボディケア」等 |
| 注文確認 | Flex Message (Bubble) | 注文番号・ステータス・追跡リンク |

### Flex Message — 商品カード例

```json
{
  "type": "bubble",
  "hero": {
    "type": "image",
    "url": "https://cdn.shopify.com/...",
    "size": "full",
    "aspectRatio": "1:1",
    "aspectMode": "cover"
  },
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      { "type": "text", "text": "ハンドクリーム", "weight": "bold", "size": "lg" },
      { "type": "text", "text": "乾燥が気になる方に。", "size": "sm", "color": "#666" },
      { "type": "text", "text": "¥2,800", "size": "lg", "weight": "bold", "margin": "md" }
    ]
  },
  "footer": {
    "type": "box",
    "layout": "horizontal",
    "contents": [
      {
        "type": "button",
        "style": "primary",
        "color": "#333333",
        "action": { "type": "uri", "label": "詳細を見る", "uri": "https://elxea.com/..." }
      }
    ]
  }
}
```

---

## 8. 会話フロー例

### 新規ユーザー（友達追加）

```
[自動] こんにちは！elxea へようこそ 🌿
       日々の暮らしに寄り添うプロダクトをお届けしています。

       何でも気軽に聞いてくださいね。
       商品のこと、使い方、ギフト選び…なんでもどうぞ！

       [Quick Reply: 商品を探す / おすすめ診断 / 会員連携]
```

### 商品相談（Notion-grounded）

```
顧客: 乾燥肌におすすめのハンドクリームある？

Agent: (search_knowledge: "乾燥肌 ハンドクリーム おすすめ" を呼び出し)
       → Notion「商品 DB」から該当商品のチャンクを取得
       (get_customer_info で過去の購入確認)

       乾燥肌にはこちらがおすすめです！

       [Flex: ハンドクリーム A カード]
       [Flex: ハンドクリーム B カード]

       A は保湿力が高めで、B はさらっとした使い心地です。
       普段どんなテクスチャーがお好みですか？

       ※ A, B の情報はすべて Notion「商品 DB」から取得。
       ※ AI が勝手に「保湿成分が〜」等の一般知識を付加しない。

顧客: しっとりめがいいな

Agent: (search_knowledge: "ハンドクリームA 生産者" を呼び出し)
       → Notion「コンテンツ DB」から生産者情報を取得

       それなら A がぴったりですね！
       実はこのクリーム、〇〇さんのラベンダーを
       使っていて、香りもすごくいいんです。

       生産者さんのストーリーはこちら ↓
       [Flex: 記事カード]

       [Quick Reply: カートに入れる / 他も見る / 使い方を聞く]
```

### ナレッジにない質問への対応

```
顧客: この商品、妊娠中でも使えますか？

Agent: (search_knowledge: "妊娠中 使用 安全性" を呼び出し)
       → 該当ナレッジなし

       申し訳ありません、そちらについては正確な情報を
       持ち合わせていないので、確認してお返事しますね。

       少々お待ちいただけますか？

       (escalate_to_human: "妊娠中の使用可否について質問。
        ナレッジに該当情報なし。" を呼び出し)
```

### エスカレーション

```
顧客: 届いた商品が破損していたんだけど

Agent: それは申し訳ありません…！
       破損の状況を確認して、すぐに対応させていただきます。

       担当スタッフに引き継ぎますね。少々お待ちください。

       (escalate_to_human ツール呼び出し)

[Slack #customer-support に通知]
  📢 エスカレーション
  顧客: 山田太郎 (LINE: Uxxxx, Shopify: #1234)
  理由: 商品破損の報告
  直近の会話: [会話履歴]
```

---

## 9. データフロー図

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│ Notion   │────▶│ Sync         │────▶│ Supabase        │
│ Knowledge│     │ Pipeline     │     │ pgvector        │
│ Base     │     │ (polling     │     │ (embedding      │
│          │     │  + manual)   │     │  index)         │
└──────────┘     └──────┬───────┘     └──────┬──────────┘
                        │                    │
                        ▼                    │
              ┌────────────────┐             │
              │ Proactive      │             │
              │ Engine         │             │
              │ (コンテンツ更新 │             │
              │  → 配信)       │             │
              └───────┬────────┘             │
                      │                      │
                      ▼                      │
┌──────────┐  ┌──────────────┐  ┌───────────┴─────┐
│ LINE     │◀─│ Agent Core   │─▶│ RAG Search      │
│ Platform │─▶│ (Claude API) │  │ (Notion         │
└──────────┘  │              │  │  knowledge only) │
              │              │  └─────────────────┘
              │              │
              │              │─▶┌─────────────────┐
              │              │  │ Shopify API      │
              │              │◀─│ (customers,      │
              │              │  │  orders のみ)    │
              └──────┬───────┘  └─────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ Supabase     │
              │ - CDP        │
              │ - 会話履歴    │
              │ - pgvector   │
              └──────────────┘
```

---

## 10. MVP スコープ — 最速ローンチ

### 方針
- **別リポ `elxea-agent` として独立デプロイ**（EC サイトと障害分離）
- Runtime: Hono on Cloudflare Workers or Next.js standalone（軽量で高速起動）
- ナレッジは**主力商品 5-10 点 + 基本 FAQ 10-20 件**で開始
- 足りないナレッジは「確認します」→ エスカレーションで逃がす
- 完璧を目指さず、動くものを最速で出して改善ループを回す

### MVP-α（まず動かす）
- [ ] `elxea-agent` リポ作成 + デプロイ環境セットアップ
- [ ] LINE 公式アカウント開設 + Messaging API 設定
- [ ] LINE Webhook エンドポイント（受信 + 署名検証）
- [ ] Claude API 連携（tool_use + グラウンディングルール）
- [ ] Notion にナレッジ DB を作成（商品 / FAQ / ブランド情報）
- [ ] Notion → Supabase pgvector 同期スクリプト
- [ ] `search_knowledge` ツール（RAG 検索）
- [ ] Supabase セットアップ（pgvector + 会話履歴）
- [ ] テキスト返信で動作確認

### MVP-β（ローンチ可能にする）
- [ ] Flex Message テンプレート（商品カード）
- [ ] Shopify 顧客情報・注文確認ツール
- [ ] LIFF: メールベースの会員連携
- [ ] リッチメニュー設定
- [ ] エスカレーション → Slack 通知
- [ ] ソフトローンチ（少人数テスト）

### MVP でやらないこと
- Web チャットウィジェット
- メール配信
- Proactive Engine（コンテンツ起点の自動配信）
- 高度なセグメンテーション
- 管理画面（ダッシュボード）
- Shopify 商品データの Notion 自動同期（手動管理で開始）

### MVP の成功指標
- LINE 友達追加 → 会員連携率: 30%+
- 会話からの商品ページ遷移率: 20%+
- エスカレーション率: 10% 以下
- 顧客満足度: 会話後アンケート 4.0/5.0+

---

## 11. 開発スケジュール

### MVP-α: テキストで会話できる状態（Week 1-2）

```
[Setaka / チーム]
  - LINE 公式アカウント開設
  - Notion にナレッジ DB 作成 + 主力商品 5-10 点 + FAQ 投入

[Developer]
  Week 1:
    - elxea-agent リポ作成 + デプロイ環境セットアップ
    - Supabase プロジェクト作成（pgvector 有効化）
    - LINE Webhook エンドポイント
    - Claude API 基本連携 + System Prompt
    - Notion → pgvector 同期スクリプト

  Week 2:
    - search_knowledge ツール（RAG）
    - 会話履歴の保存
    - テキスト返信で E2E 動作確認
    → MVP-α 完了: LINE でテキスト会話ができる
```

### MVP-β: ローンチ可能（Week 3-4）

```
  Week 3:
    - Flex Message（商品カード）
    - Shopify 顧客情報・注文確認ツール
    - エスカレーション → Slack 通知

  Week 4:
    - LIFF 会員連携フォーム
    - リッチメニュー
    - System Prompt チューニング
    - ソフトローンチ（身内テスト → 少人数公開）
```

### Phase 2: 成長

- ナレッジ拡充（全商品 + コンテンツ DB）
- Proactive Engine（Notion 更新 → LINE 配信）
- Web チャットウィジェット
- 会話分析ダッシュボード

### Phase 3: 高度な CRM

- メール統合
- 高度なセグメンテーション
- A/B テスト
- 購入起点のフォローアップ自動化

---

## 12. コスト試算（MVP 月額）

| 項目 | 想定コスト | 備考 |
|------|-----------|------|
| LINE 公式アカウント | ¥5,000 | Standard プラン（5,000 通/月） |
| Claude API | ¥5,000-15,000 | 会話量による。Sonnet で ¥3/1K input tokens |
| Supabase | ¥0 | Free プラン（500MB DB, 50K MAU） |
| Vercel | ¥0 | Hobby or Pro（既存） |
| **合計** | **¥10,000-20,000/月** | 初期は低コストで開始可能 |

**コスト最適化のポイント**:
- Reply メッセージ（ユーザー起点）はカウント対象外 → AI チャットは実質無料
- Push メッセージ（能動配信）のみがカウント対象
- Claude API: Sonnet でほとんどのケースは十分。Haiku をフォールバックに使う手もあり

---

## 13. セキュリティ・プライバシー

- LINE Webhook の署名検証を必ず実装
- 顧客の個人情報は Supabase に暗号化保存
- 会話ログの保持期間を設定（例: 1 年）
- Claude API に送信するデータの範囲を明示（個人情報の最小化）
- LIFF アプリの HTTPS 必須
- Shopify Admin API トークンのスコープを最小限に
- Notion API トークンは必要な DB のみにスコープを絞る
