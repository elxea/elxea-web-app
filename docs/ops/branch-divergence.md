# ブランチ乖離の監視と停止 (Branch Divergence)

対象事故: elxea「259コミット乖離」(作業コピーが本流から大きくズレて戻せなくなった)
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP3

---

## 1. しきい値

DORA基準 (1日1回マージ・1週間超のバッチは大きすぎる) に合わせ、`git-ops-review.md` で厳格化した値を採用する。

| 区分 | しきい値 | 意味 |
|---|---|---|
| **warn (警告)** | mainから **behind > 20 commits** または **age > 3 days** | そろそろmainを取り込め |
| **stop (停止)** | mainから **behind > 50 commits** または **age > 7 days** | これ以上積み増すな。まず統合せよ |

- `behind` = mainが持ち、そのブランチが持たないコミット数 (`git rev-list <branch>..origin/main`)。
- `age` (バッチ齢) = そのブランチ固有の最古コミットからの経過日数。未マージ作業がどれだけ滞留しているか。
- しきい値はenvで上書き可: `BRANCH_WARN_COMMITS` / `BRANCH_WARN_DAYS` / `BRANCH_STOP_COMMITS` / `BRANCH_STOP_DAYS`。

## 2. 仕組み

スクリプト: `scripts/ops/check-branch-divergence.mjs` (behind/ahead/age を測りwarn/stop/ok に分類)

2つのworkflowで運用する:

1. **定期監査** `.github/workflows/branch-divergence.yml` (毎日09:20 JST + 手動)
   - originの全未マージブランチを測ってwarn/stopを集計し、GitHub Actionsのサマリとannotationに出す。
   - **この監査自体はブロックしない (常にexit 0)。** 理由: 導入時点でこのリポには既に多数のlegacy乖離ブランチが存在し、ここでfailさせると常時赤になってsignalを失う。可視化に徹する。
2. **pushガード** `.github/workflows/branch-push-guard.yml` (main以外へのpushで発火)
   - pushされたブランチが **stop超過ならCIを失敗させる**。これがハードな「作業停止」の機械強制。
   - これ以上積み増せない → まず `git merge origin/main` / rebaseで取り込むか、分割してマージしてからpushし直す。
   - PRトリガーでなくpushトリガーで発火させている (PRトリガーだと追いコミット時に発火しないため。review指摘)。

## 3. legacyブランチの整理 (導入時の宿題)

導入時の監査で、多数の未マージブランチがstopを超過している (数百コミットbehindの放置ブランチを含む)。これらはpushガードでは是正されない (pushしない限り発火しない) ため、別途整理する:

- mainにマージ済み相当のものはremoteから削除する。
- 生きているが古いものはmainを取り込んで分割マージする。
- 整理後、`branch-divergence.yml` を `--fail-on-stop` 付きに切り替えれば、監査自体もゲートにできる。

## 4. 運用

- `warn` を見たら、その日のうちにmainを取り込む (毎日少しずつ統合するのが構造的な予防)。
- `stop` に達したブランチへは追加pushがCIで落ちる。滞留を解消してから再開する。
- 長生きブランチの正規な代替 (未完成機能を隠したまま本流開発を続ける) はFeature Flag (P4)。
