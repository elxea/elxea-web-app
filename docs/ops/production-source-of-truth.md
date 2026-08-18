# 本番の正本 = main (Production Source of Truth)

対象事故: elxea「259コミット乖離・本番認識割れ・検証停止」(2026-08)
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP2 / 追加(a)

---

## 1. 宣言 (SoT)

- **本番の正本は `main` ブランチである。**
- **Vercel productionは `main` から配信される。** `main` に入ったコミットだけが本番になる。
- 本番に出ているコードは、常に「`main` のHEADと同じコミット」でなければならない。ズレている状態 = 認識割れ = 障害の前段階とみなす。

配信経路の事実 (2026-08時点):

- 本番デプロイはGitHub Actions `.github/workflows/ci.yml` の **`deploy-production` job** が `push: main` で起動し、Vercel CLI (`vercel deploy --prod`、ソースからのビルド) でproductionに配信する。VercelネイティブGit連携は使っていない (org所有のprivate repoでは有料プラン必須のため)。
  - **`.github/workflows/deploy.yml` はもう存在しない** (2026-08-12にci.ymlへ統合)。ローカル作業コピーに残っている同名ファイルは古い残骸であり、これを根拠に判断すると誤る。
- したがって「本番 = `main`」はVercel設定ではなく **このci.yml + 本監視**で担保する。

### 「デプロイした」の判定 (重要 — ここを間違えて事故が起きた)

- **`deploy-production` が緑であることは、本番に出た証拠ではない。** リポジトリ変数 `DEPLOY_ENABLED` が `true` でないあいだ、このjobは **skipped (灰)** になる。skippedはGitHubの仕様上「成功」として集計されるため、run全体のチェックマークだけを見ると配信済みと読めてしまう。
  - 2026-08-18: 実際にこの誤読が起き、Vercelに一度も出ていないコミットが「本番反映完了」と報告された (当時はstepゲートで **success(緑)** を返していた。現在はjobごとskippedになり、同じrunの `ship-gate` jobが表示名で `NOT ARMED — nothing is deployed` と名乗る)。
- 本番に出たかどうかは、次のいずれかで **Vercel側を見て**判定する:
  1. 同じrunの `ship-gate` jobの表示名 / Summaryが `ARMED` であり、かつ `deploy-production` が実際に走って緑であること。
  2. `vercel ls --prod` の最新production deploymentの作成時刻がマージ時刻より後で、`vercel inspect` のAliasesに `elxea.com` が載っていること。
  3. 監視 `check-prod-main-sync.mjs` が `in_sync` を返すこと (REST APIの `meta.githubCommitSha` 比較)。

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
| `unverifiable` | **照合そのものができなかった** (token無し / API不通 / meta未付与 / main HEAD不明) | 監視が武装できていない。`unverifiableCause` を見て原因を除去する |

`in_sync` / `drift` / `rollback_suspected` は `verified: true` (実際に照合した結論)。`unverifiable` は `verified: false` で、**「異常なし」ではなく「不明」**を意味する。

> **旧 `unknown` は廃止した (2026-08-18)。** v1では `unknown` を `in_sync` と同じ「緑」に丸めており、`--fail-on-drift` を付けてもexit 0を返していた。`VERCEL_TOKEN` が無いあいだ、この監視は1日2回「何も検証せずに緑」を返し続ける。259 commit分・約14時間のズレが誰にも気付かれなかった一因がこれ。**「検証していない」と「検証して問題なかった」を同じ色で表現しない**のがv2の主眼。

### 終了コード (fail-closed)

| exit | 意味 |
|---|---|
| 0 | `in_sync` (照合して一致)。`--fail-on-drift` を付けない情報取得実行も常に0 |
| 1 | `drift` / `rollback_suspected` (照合して異常) |
| 2 | スクリプト自体の例外 |
| 3 | `unverifiable` (照合できなかった)。**ゲート実行では既定でこれ = 緑にしない** |

恒久的に武装できない環境で赤を出し続けたくない場合だけ、呼び出し側が `--unverifiable-exit 0` を明示する。黙って緑になる経路は無く、その判断はコマンドラインに残って監査できる。

**これは検知 (warn) であって機械強制ではない。** 起票されても誰も動かなければ乖離は続く。ズレたら24h以内に是正する運用 + Bossエスカレで担保する。定期workflowは `drift` / `rollback_suspected` / `unverifiable` でCIを失敗させ、通知の起点にする。

判定ロジックは `scripts/ops/lib/prod-main-sync-verdict.mjs` に純関数として切り出してあり、`__tests__/ops/prod-main-sync-verdict.test.ts` が正常 / ずれあり / 検証不能の3パターンをfixtureで固定している (デグレしたらCIが赤くなる)。

> **docs-only先行はdriftにしない**: `deploy.yml` はdocs / `*.md` / `LICENSE` だけのpushを `paths-ignore` でスキップする。そのためdocsのみのmerge後はmain HEADが進んでも本番はデプロイされずSHAがズレる。これは正常なので、監視は「mainがprodより進んでいて、その差分がdeploy-ignoreパス (docs/md/LICENSE) だけ」のときは `in_sync` とみなす (false drift防止)。判定にはprodコミットを解決できる完全なgit履歴が要るため、定期workflowは `fetch-depth: 0` でcheckoutする。

> `unverifiable` は過渡状態でありうるが、緑ではない: この監視の初回導入直後、`--meta` が付いた本番デプロイがまだ1回も出ていない間は `meta.githubCommitSha` が空で `unverifiable` (`unverifiableCause: production_sha_missing`) になる。次回のmainへのpush由来デプロイ以降で解消する。**解消するまでのあいだ、この監視は本番のズレを検知できない**ことを忘れないこと (それを見えるようにするのがexit 3と `[SKIP] NOT VERIFIED` 表示)。

## 4. 追加(a): セッションをまたいだ本番認識の配布

検知結果を「人向け起票」だけで終わらせると、各エージェントセッションは起動時に正しい本番認識を得られず、認識割れがセッション単位で再発する。そこで照合結果を **状態ファイル**に書き出し、全セッションが同じ本番認識を読めるようにする。

- 書き出し (実装済み): 監視スクリプトに `--state-out <path>` を渡すと状態ファイル (`elxea-prod-main-sync/v2` スキーマ) を書き出す。ローカルの定期実行 (朝の点検ジョブ) から
  ```
  node scripts/ops/check-prod-main-sync.mjs --state-out ~/.claude/progress/elxea-prod-main-sync.json
  ```
  で配布先に書ける。GitHub Actionsはクラウド実行のためローカルの `~/.claude` には書けない → 状態ファイル配布はローカル実行側の責務。
- 読み取り (**設計案・未実装**): elxea系エージェントのSessionStart hookが上記状態ファイルを読み、`status != in_sync` のときadditionalContextに「本番とmainがズレている」警告を注入する。
  - **本タスクではhook実ファイルは作成しない** (hook新規作成はSetaka承認 + QAクロスチェックが必要な対象のため)。読み取りhookの実装は別途承認フローで行う。設計のみを本節に記す。

## 5. 状態ファイル スキーマ (`elxea-prod-main-sync/v2`)

```json
{
  "schema": "elxea-prod-main-sync/v2",
  "checkedAt": "<ISO8601>",
  "repo": "elxea/elxea-web-app",
  "status": "in_sync | drift | rollback_suspected | unverifiable",
  "verified": "true = 実際に照合した / false = 照合できていない (status は unverifiable)",
  "unverifiableCause": "missing_credentials | production_api_error | production_sha_missing | main_head_unresolved | null",
  "reason": "<人間可読の理由>",
  "mainHeadSha": "<40hex or null>",
  "productionSha": "<40hex or null>",
  "productionDeploymentId": "<id or null>",
  "newestReadyDeploymentId": "<id or null>",
  "liveIsNewest": true,
  "sourceOfTruth": "main",
  "remediation": "<in_sync 時のみ null。unverifiable にも必ず入る>"
}
```

**消費側 (SessionStart hook等) の注意**: `status === 'in_sync'` だけを正常として扱うこと。`verified === false` を正常側に寄せるとv1と同じ見逃しが再発する。v1の `unknown` は存在しないので、`schema` が `v1` のままの状態ファイルを読んだら古い実行結果と判断してよい。
