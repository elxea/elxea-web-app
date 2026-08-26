# Firestoreインデックスの反映手順

`firestore.indexes.json` は **アプリのデプロイ (Vercel) では一切反映されない**。
Firestore側へ別途反映しないと、索引を要求するクエリだけが失敗し続ける。

そして失敗の仕方が静かになりやすい。実際に「人気の記事」がこれで無言のまま空に
なっていた (2026-08-12のQA指摘)。現在はフォールバックしても必ずSentryと
サーバーログに残る (`lib/journal/popular-articles.ts`) が、**索引を反映しない限り
機能は出ない**。

## 反映コマンド

```bash
pnpm deploy:indexes:dry   # 差分だけ表示 (作成しない / 差分ありは exit 2)
pnpm deploy:indexes       # 不足分を作成
```

`scripts/deploy-firestore-indexes.ts` が `firestore.indexes.json` を読み、Firestore
Admin REST APIで既存インデックスと突き合わせ、**不足分だけ**作成する (冪等)。

必要な環境変数はアプリと同じ3つ。ローカルは `.env.local` を自動で読む。
本番の値は `vercel env pull --environment=production <file>` で取得する。

| 変数 | 用途 |
|---|---|
| `FIREBASE_PROJECT_ID` | 対象プロジェクト (`elxea-ec`) |
| `FIREBASE_CLIENT_EMAIL` | サービスアカウント |
| `FIREBASE_PRIVATE_KEY` | 同・秘密鍵 (base64 / エスケープ改行の両形式に対応) |

インデックス作成は非同期。要求が受理されると `state=CREATING` で返り、`READY` に
なるまで数分かかる。`pnpm deploy:indexes:dry` で `state` を確認できる。

### なぜfirebase CLIを使わないのか

`firebase deploy --only firestore:indexes` でも同じことができるが、`firebase login`
による対話ログイン (ブラウザ) を前提とするためCIやエージェントから実行できない。
上記スクリプトは **アプリが既に持っているサービスアカウント**でREST APIを直接
叩くので、新しい認証情報も新しい依存も要らない。

## 現状 (2026-08-26再確認): 作成は権限不足でブロック中

| 操作 | 状態 |
|---|---|
| 一覧取得 (`datastore.indexes.list`) | [OK] サービスアカウントで成功 |
| 作成 (`datastore.indexes.create`) | [FAIL] HTTP 403 PERMISSION_DENIED |

2026-08-26に再実行して403が続いていることを確認した。あわせて、この手順が
そもそも実行できない状態だった3点を修正済み (これらは権限とは別の穴だった)。

| 直した箇所 | 何が壊れていたか |
|---|---|
| `package.json` | `deploy:indexes` / `deploy:indexes:dry` が未定義で、本ドキュメントと `lib/journal/popular-articles.ts` が案内するコマンドが存在しなかった |
| `lib/firebase/admin.ts` | `decodePrivateKey` が未exportで、スクリプトが起動時に `is not a function` で落ちていた |
| `firestore.indexes.json` | 「人気の記事」が必要とする `behaviorLog` の **COLLECTION_GROUP** 定義が欠けていた (COLLECTION版しか無く、`collectionGroup()` クエリを救えない) |

したがって **残る障害はIAMのロール付与1点のみ**。付与されれば
`pnpm deploy:indexes` の1コマンドで6件が反映される。

つまり **差分の検出まではできるが、反映はできない**。`elxea-ec` の
`firebase-adminsdk-fbsvc@elxea-ec.iam.gserviceaccount.com` に索引作成権限が付いて
いないため。gcloud側のowner認証 (`setaka@circl.co.jp` / `setaka-on@elxea.com`) は
いずれも再認証待ちで、非対話では使えない。

### 解除に必要な操作 (owner権限が要る / 未実施)

次のどちらか。**1の方を推奨** (最小権限で、以後CI・エージェントから反映できる)。

1. サービスアカウントに索引管理ロールを付与する

   ```bash
   gcloud projects add-iam-policy-binding elxea-ec \
     --member="serviceAccount:firebase-adminsdk-fbsvc@elxea-ec.iam.gserviceaccount.com" \
     --role="roles/datastore.indexAdmin"
   ```

   付与後は `pnpm deploy:indexes` が通る (追加の認証は不要)。

2. owner本人の認証で1回だけ反映する

   ```bash
   gcloud auth login            # 対話 (ブラウザ)
   firebase login               # 対話 (ブラウザ)
   firebase deploy --only firestore:indexes
   ```

#### エージェントが代行できない理由 (2026-08-26に実地確認)

1も2も **owner本人しか実行できない**。自動化の経路は両方とも塞がっている。

| 経路 | 結果 |
|---|---|
| gcloud CLI (`setaka-on@elxea.com`) | 再認証待ちで `cannot prompt during non-interactive execution` |
| GCPコンソール (ブラウザ自動操作) | パスワードは通るが、2段階認証がデバイス通知 (本人のiPhone/iPad) に到達して停止 |

ブラウザ経路では代替手段としてSMSとバックアップコードも提示されるが、SMSは本人の
端末、バックアップコードはBitwardenに未登録のため、いずれも代行できない。

**したがってロール付与はSetaka本人の手作業が必要**。上記1のコマンドを
`setaka-on@elxea.com` でログイン済みの端末で1回実行すれば、以後は
`pnpm deploy:indexes` がエージェント・CIから通るようになる (この作業は一度きり)。

### 反映が必要な未作成インデックス (2026-08-26実測 / 9件中6件が未反映)

`pnpm deploy:indexes:dry` の出力。定義9件のうち本番に存在するのは3件だけ
(`comments` 1件 + `favorites` 2件) で、2026-08-12から変化していない。

| collectionGroup | scope | fields | 影響 |
|---|---|---|---|
| `behaviorLog` | COLLECTION | `channel` ASC, `createdAt` DESC | チャネル別の行動ログ集計 |
| `behaviorLog` | COLLECTION | `action` ASC, `createdAt` DESC | 行動種別の集計 |
| `behaviorLog` | COLLECTION | `personaSignal` ASC, `createdAt` DESC | ペルソナ推定 |
| `behaviorLog` | COLLECTION_GROUP | `action` ASC, `createdAt` DESC | **人気の記事** (QA指摘の対象) |
| `conversations` | COLLECTION | `role` ASC, `createdAt` DESC | 会話履歴の絞り込み |
| `orders` | COLLECTION | `createdAt` DESC | 注文の新着順 |

「人気の記事」以外にも未反映が5件ある。QA指摘は1件だったが、同じ穴に落ちて
いる機能が他にもあるということ。権限が解除できたら6件まとめて反映する。

## 索引を追加するとき

1. `firestore.indexes.json` に定義を追記する
2. `pnpm deploy:indexes` で反映する (この2手を必ず対で行う)
3. 索引を要求するクエリ側には、失敗しても無言にならない経路を用意する
   (`lib/journal/popular-articles.ts` の `reportPopularArticlesFailure` が実装例)
