# 本番の確認を秘密情報なしで回す (`/api/version` + `verify-production.mjs`)

> **これが答える問い**: 「いま本番で答えているコードはどのコミットか」。
> **答えないこと**: 「ページの中身が正しいか」。中身の確認はサイトパスワードが要る。

## なぜ要るのか

本番はサイトパスワードで守られているため、パスワードを持たない側 (エージェント・監視・当番でない人) は本番の実体を確認できない。「200 が返るか」だけの監視では、**古いデプロイが生きていても緑**になる。実際に 2026-08-18、`unverifiable` を緑として扱ったまま 259 コミット分のズレが誰にも気付かれなかった。

## 既存の `check-prod-main-sync.mjs` との違い (重複ではない)

| | 何を根拠にするか | 秘密 | 前段の CDN を見抜けるか |
|---|---|---|---|
| `check-prod-main-sync.mjs` | Vercel の**デプロイ記録** (`meta.githubCommitSha`) | `VERCEL_TOKEN` が要る | 見抜けない |
| `verify-production.mjs` (これ) | **動いているアプリ自身の応答** | 不要 | 見抜ける |

「Vercel がデプロイしたと記録している」と「いまリクエストに答えているコードがそれだ」は別の事実。本番の前段には Cloudflare が居る (実測 2026-09-11: `server: cloudflare` / `cf-cache-status: DYNAMIC`) ため、デプロイ記録だけでは配信面の実体を保証できない。2 本は**置き換えではなく併用**する。

## 使い方

```bash
# 今の本番が何を配信しているか
node scripts/ops/verify-production.mjs

# main の HEAD が本番に出ているかを照合する (デプロイ後の確認)
node scripts/ops/verify-production.mjs --expect-sha "$(git rev-parse origin/main)"

# 機械で読む
node scripts/ops/verify-production.mjs --json
```

`PRODUCTION_URL` / `--base-url` で対象を差し替えられる (既定 `https://elxea.com`)。

## 終了コード (fail-closed)

| code | result | 意味 |
|---|---|---|
| 0 | `ok` | 検証できて、期待どおり |
| 1 | `drift` | 検証できて、期待と違う (SHA ずれ / 保護の緩み / ルート異常) |
| 2 | `unverifiable` | **検証できなかった** (到達不能 / SHA が unknown) |

**`unverifiable` を成功として扱わないこと。** 「検証していない」を「検証して問題なかった」と同じ緑で表現したのが、上記 259 コミットの見逃しの原因。

## 何を見ているか

1. `GET /api/version` — 配信中の commit SHA / 短縮 SHA / 環境。認証不要
2. `--expect-sha` との照合
3. 主要ルート (`/`, `/ja`, `/ja/products`, `/ja/journal`, `/ja/about`) が応答するか (404 / 5xx でないか)
4. 本番で `/ja` が 200 を返していないか = **サイトパスワード保護が緩んでいないか**

### 今は見ていないこと (誇張しないための明記)

**ルートごとに配信ビルドを個別に突き合わせることはしていない。** それには全応答へビルドヘッダーを付ける `middleware.ts` の変更が要り、現状は行っていない。したがって「`/api/version` は新ビルド、しかし `/ja` はまだ旧ビルドが応答している」という部分的な入れ替わりは検知できない。必要になったら middleware 側で別途判断する。

## 保護を緩めていないか

緩めていない。`middleware.ts` の matcher は元から `/api` を除外している (`"/((?!studio|api|password|_next|.*\\..*).*)"`)。実測 (2026-09-11): `/api/health/line` は 200、サイト本体 `/` は 307 → `/password`。**この経路のために middleware は触っていない。**

`/api/version` が返すのは状態 (SHA / 短縮 SHA / 環境) のみで、ページの内容・データ・環境変数は含まない。キー集合は `__tests__/api-version.test.ts` が固定しており、うっかり別の値を混ぜるとテストが落ちる。値は `no-store` で返す (CDN がキャッシュすると「昔の SHA」を見て緑にする事故が起きるため)。
