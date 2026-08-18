# 本番の確認を「人の秘密なし」で回す

## 何のためのドキュメントか

本番 (https://elxea.com) はサイトパスワードで保護されている。エージェントはパスワードを入力できないため、これまで**本番の中身を一切確認できなかった**。その結果2026-08-18に「本番が古いデプロイのまま14時間気づかれない」事故が起きた。さらに同日、**「200が返るか」だけの監視では古いデプロイが生きていても緑になる**ことが実証されている。

必要なのは「応答があるか」ではなく「**何が**配信されているか」。

## 3層で見る

| 層 | 何を見るか | 認証 | どこ |
|---|---|---|---|
| L1 | 公開ドメインが**実際に返している**ビルド | 不要 | `GET /api/version` / 全レスポンスの `x-elxea-build` |
| L2 | L1が期待コミットと一致するか | 不要 | `scripts/ops/verify-production.mjs` → `.github/workflows/prod-verify.yml` |
| L3 | Vercelが**デプロイしたと言っている**コミット | VERCEL_TOKEN | `scripts/ops/check-prod-main-sync.mjs` → `prod-main-sync.yml` (既存) |

L3だけでは「Vercelはデプロイしたが公開ドメインは別の面を指したまま」を捕まえられない。L1/L2はドメインが返す実体を見るのでそれが捕まる。

## L1: `GET /api/version`

```
curl -s https://elxea.com/api/version
{"sha":"…","shaShort":"…","builtAt":"2026-…Z","env":"production","deploymentId":"dpl_…"}
```

設計上の判断:

- **サイトパスワードは一切緩めていない。** `middleware.ts` のmatcherは元から `/api` を除外している (`"/((?!studio|api|password|_next|.*\\..*).*)"`)。この経路のための例外追加はゼロ。サイト本体は今までどおりパスワードなしでは見られない。
- **返すのは状態だけで中身は返さない。** キー集合は `lib/build-info.ts` の `getPublicBuildInfo()` に固定され、`__tests__/api-version.test.ts` が集合そのものを検査する。フィールドを増やすとテストが落ちるので「うっかり他の情報も返す」事故が起きない。
- **漏れても被害が小さい。** 分かるのは「どのコミットがいつから本番か」だけ。認証情報・データ・ページ内容は含まない。`X-Robots-Tag: noindex` と `Cache-Control: no-store` を付け、公開面として宣伝もキャッシュもしない。
- **値はビルド時に焼き込む** (`next.config.ts`)。実行時の環境変数に依存しないので「設定を入れ忘れてunknown」が起きにくい。取れなかった場合は空にせず `"unknown"` を返し、検証側が **fail-closed** にできるようにしてある。

## ルートの健全性

ページ本体は認証なしでは307 (→ `/password`) しか返さない。そこで `middleware.ts` が**全レスポンス (307を含む) に `x-elxea-build` ヘッダー**を付ける。これで中身を一切見せずに、

- 主要ルートが応答しているか (5xx / 404になっていないか)
- **そのルートがどのビルドで応答したか** (`/api/version` と一致するか)

の両方が取れる。ルートごとにビルドが食い違えば「配信面がまだ入れ替わっていない」と分かる。

## 使い方

```bash
# 今の本番の実体を見る
node scripts/ops/verify-production.mjs

# main HEAD が本番に出ているか
node scripts/ops/verify-production.mjs --expect-sha "$(git rev-parse origin/main)"

# 24 時間以上更新されていないなら失敗させる
node scripts/ops/verify-production.mjs --max-age-hours 24 --json
```

終了コード: `0` = 期待どおり / `1` = ずれ・保護の緩み・ルート異常 / `2` = **検証不能**（到達不能、SHAがunknown）。`2` を成功として扱わないこと。

`prod-verify.yml` がCI (デプロイ) 完了後・1日2回・手動 (`gh workflow run prod-verify.yml`) の3経路で同じスクリプトを回す。デプロイ直後の入れ替わり待ちのため最大10回 × 30秒だけ収束を待ち、収束しなければ失敗する。

## 記事同期の認証情報 (登録依存の解消)

`sync-notion-to-sanity.yml` が要る4つの値は、**本番サイトが動いている以上Vercelのproduction環境変数に既に存在する**。それをGitHub Secretsに二重登録させていたので、オーナーが手で登録するまで一度も動かせなかった。

いまは既存の `VERCEL_TOKEN`（deployとprod-main-syncが既に使っている1本）で `vercel env pull` して使う。**新規に登録してもらう秘密はゼロ。**

- 引いた値はランナー上の一時ファイルにだけ置き、`::add-mask::` でログに出ないようにする。argvには載せない。
- GitHub Secretsが登録されていればそちらが優先される（`scripts/lib/sync-env.ts` は既存の環境変数を上書きしない）。未登録のsecretは空文字になるので、空を「未設定」とみなしてVercel側にフォールバックする。
- 「どの値がどこにあるか」はworkflowのJob Summaryに**名前だけ**出る。値は出さない。残りの手作業件数を推測ではなく実測で確認できる。
