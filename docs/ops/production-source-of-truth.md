# 本番の正本 = main (Production Source of Truth)

対象事故: elxea「259コミット乖離・本番認識割れ・検証停止」(2026-08)
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP2 / 追加(a)

---

## 1. 宣言 (SoT)

- **本番の正本は `main` ブランチである。**
- **Vercel productionは `main` から配信される。** `main` に入ったコミットだけが本番になる。
- 本番に出ているコードは、常に「`main` のHEADと同じコミット」でなければならない。ズレている状態 = 認識割れ = 障害の前段階とみなす。

配信経路の事実 (2026-08時点):

- 本番デプロイはGitHub Actions `.github/workflows/deploy.yml` が `push: main` で起動し、Vercel CLI (`vercel pull → build → deploy --prebuilt --prod`) でproductionに配信する。VercelネイティブGit連携は使っていない (org所有のprivate repoでは有料プラン必須のため)。
- したがって「本番 = `main`」はVercel設定ではなく **このdeploy.yml + 本監視**で担保する。

## 2. なぜ静かにズレるか (Vercelロールバック仕様)

Vercelはproductionをロールバック (Instant Rollback) すると **productionドメインの自動割り当てをOFFにする**。以降 `main` にpushしても本番へ反映されなくなる (ロールバック済みデプロイが出続ける)。復帰はUndo / 明示promoteが必要。

- この仕様のため「`main` は進んでいるのに本番は古いコミットのまま」という認識割れが**無言で**発生しうる。これが今回事故の一因と同型。
- **プラン依存の注意 (要確認)**: Vercel Hobbyプランは「直前1デプロイ」にしかロールバックできない。Pro/Enterpriseはeligibleな全デプロイに戻せる。現状のVercel scopeは個人チーム `setaka1103's projects` で、プランtierは未確定。運用 (ロールバック → 24h以内Undo) の前提が変わるため、プランを確認すること。

## 3. 監視 (検知であって強制ではない)

スクリプト: `scripts/ops/check-prod-main-sync.mjs`
定期実行: `.github/workflows/prod-main-sync.yml` (毎日09:10 / 21:10 JST + 手動)

やること:

1. `origin/main` のHEAD SHAを取得 (gh api / git ls-remote)。
2. Vercel REST APIから **現在productionとして配信中のデプロイ**のgit SHA (`meta.githubCommitSha`) を取得。`deploy.yml` が各本番デプロイに `--meta githubCommitSha` を付けているので読める。
   - 注: Vercel CLIの `vercel inspect` は `meta` を落とすため、監視はREST APIを使う。
3. 両者を照合し、さらに「配信中デプロイ = 最新READYデプロイか」を確認 (ロールバック検知)。

判定 (`status`):

| status | 意味 | 対応 |
|---|---|---|
| `in_sync` | 本番SHA == main HEAD | なし (正常) |
| `drift` | 本番SHA != main HEAD | 24h以内に是正 (再デプロイ)。Bossへエスカレ |
| `rollback_suspected` | 配信中が最新READYでない (auto-assign OFFの疑い) | Undo / promoteで復帰。Bossへエスカレ |
| `unknown` | SHA未確定 (token無し / meta未付与の旧デプロイ) | 情報不足。原因を除去して再照合 |

**これは検知 (warn) であって機械強制ではない。** 起票されても誰も動かなければ乖離は続く。ズレたら24h以内に是正する運用 + Bossエスカレで担保する。定期workflowは `drift` / `rollback_suspected` でCIを失敗させ、通知の起点にする。

> **docs-only先行はdriftにしない**: `deploy.yml` はdocs / `*.md` / `LICENSE` だけのpushを `paths-ignore` でスキップする。そのためdocsのみのmerge後はmain HEADが進んでも本番はデプロイされずSHAがズレる。これは正常なので、監視は「mainがprodより進んでいて、その差分がdeploy-ignoreパス (docs/md/LICENSE) だけ」のときは `in_sync` とみなす (false drift防止)。判定にはprodコミットを解決できる完全なgit履歴が要るため、定期workflowは `fetch-depth: 0` でcheckoutする。

> `unknown` は正常な過渡状態でありうる: この監視の初回導入直後、`deploy.yml` の `--meta` が付いた本番デプロイがまだ1回も出ていない間は `meta.githubCommitSha` が空で `unknown` になる。次回のmainへのpush由来デプロイ以降で解消する。

## 4. 追加(a): セッションをまたいだ本番認識の配布

検知結果を「人向け起票」だけで終わらせると、各エージェントセッションは起動時に正しい本番認識を得られず、認識割れがセッション単位で再発する。そこで照合結果を **状態ファイル**に書き出し、全セッションが同じ本番認識を読めるようにする。

- 書き出し (実装済み): 監視スクリプトに `--state-out <path>` を渡すと状態ファイル (`elxea-prod-main-sync/v1` スキーマ) を書き出す。ローカルの定期実行 (朝の点検ジョブ) から
  ```
  node scripts/ops/check-prod-main-sync.mjs --state-out ~/.claude/progress/elxea-prod-main-sync.json
  ```
  で配布先に書ける。GitHub Actionsはクラウド実行のためローカルの `~/.claude` には書けない → 状態ファイル配布はローカル実行側の責務。
- 読み取り (**設計案・未実装**): elxea系エージェントのSessionStart hookが上記状態ファイルを読み、`status != in_sync` のときadditionalContextに「本番とmainがズレている」警告を注入する。
  - **本タスクではhook実ファイルは作成しない** (hook新規作成はSetaka承認 + QAクロスチェックが必要な対象のため)。読み取りhookの実装は別途承認フローで行う。設計のみを本節に記す。

## 5. 状態ファイル スキーマ (`elxea-prod-main-sync/v1`)

```json
{
  "schema": "elxea-prod-main-sync/v1",
  "checkedAt": "<ISO8601>",
  "repo": "elxea/elxea-web-app",
  "status": "in_sync | drift | rollback_suspected | unknown",
  "reason": "<人間可読の理由>",
  "mainHeadSha": "<40hex or null>",
  "productionSha": "<40hex or null>",
  "productionDeploymentId": "<id or null>",
  "newestReadyDeploymentId": "<id or null>",
  "liveIsNewest": true,
  "sourceOfTruth": "main",
  "remediation": "<is_sync/unknown 時は null>"
}
```
