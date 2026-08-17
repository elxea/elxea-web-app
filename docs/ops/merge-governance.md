# mainへのマージ経路の限定と権限分離 (Merge Governance)

対象事故: elxea「エージェントが本番に直接手を出せた」(実装役が第三者チェックなしで本流へ流せた)
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP6 / 追加(c)、および `git-ops-review.md` の担保差し替え

---

## 1. なぜ「承認機能」に頼れないか (前提)

このリポの開発者はほぼAIエージェントであり、**全エージェントがオーナーの同一GitHubアカウント (同一credential) でpushする**。この実態ではGitHubのapproval機構は担保にならない:

- author = approver = 同一アカウント。approvalを必須化すると誰もapproveできず全マージが詰まる。
- 必須化しなければ「自己承認防止」は何も担保されない。

したがって担保は **GitHubのapprovalではなく、アカウント数に依存しない仕組み**に組み替える (review指摘)。将来エージェント別のGitHub App / machine accountを用意したら、その時点でapproval必須化を再検討する。

> 補足 (出典の訂正): 「エージェントはmainに触れない・自己approveしないのが業界の公式設計」という強い主張はCopilot docsには明記がない (むしろbypass actorという緩和経路が書かれている)。本レジームは「Generator-Verifier原則 (実装者が自分の成果を自分でマージ確定しない)」を自組織の設計判断として採る、という位置づけにする。

## 2. 3層の担保 (approval非依存)

| 層 | 担保 | 状態 |
|---|---|---|
| **(1) 直接書き込み禁止 + required status checks** | GitHubブランチ保護でmainへの直pushを禁止し、CI全PASSを必須にする。アカウント数に依存しない。 | **P1**。GitHubプラン制約で保留中 → `docs/ops/branch-protection.md` |
| **(2) workerのmain書き込み・マージ操作の遮断** | elxea側hookでworker (実装役) の `git push origin main` / mainへのmerge系コマンドを遮断する。**主担保。** | **設計案のみ (本タスクではhook実ファイルを作らない)**。§4 |
| **(3) マージ実行経路の限定** | mainへのマージは **elxea-qa通過後のBoss / 専用ジョブ経路**に限定する。実装workerはmainにマージしない。 | 運用ルール (本ドキュメント)。即適用可 |

P1 (層1) が有効化されるまでは、層 (2)(3) が実効的な主担保になる。

## 3. 運用ルール (層3・即適用)

- **実装workerはmainにマージしない。** workerはfeature/developerブランチで作業し、PRを出すところまで。
- **mainへのマージはQA通過が前提。** elxea-qa (Generator-VerifierのVerifier) がPassしたものだけをマージ対象にする。QA不要区分 (ドキュメント・設定のみ 等) はBoss判断でマージ可。
- **マージ実行者はBossまたは専用マージジョブ。** 「誰が・何を・いつ」マージするかはBossが決める (circl-boss / elxea-bossの判断・委譲原則)。
- **`developer → main` はCI全PASS後のみ** (既存のCLAUDE.mdルールを踏襲)。
- Figma→コード反映タスクは、別エージェントの忠実度監査Passもマージ前提 (CLAUDE.md「Figma反映の忠実度ゲート」)。

## 4. 追加(c): headless / cron実行にも同一適用

権限分離は**対話セッションのエージェントだけでなく、自動実行 (launchd / cron / Vercel Cron / GitHub Actionsのスケジュールジョブ 等headless実行) にも適用する**。

- headlessジョブはmainに直接書き込まない。変更が要るならPRを作るところまでにとどめ、マージは層 (2)(3) の経路に乗せる。
- 自動デプロイ (`.github/workflows/deploy.yml`) は「mainに入ったものを配信するだけ」であり、mainへの書き込み権限とは別物 (本番=mainのSoTは `docs/ops/production-source-of-truth.md`)。
- 自動ジョブがどのgit権限で走るかを新設・改修するときは、この権限分離を満たすことを確認する。

## 5. hookの設計案 (層2・**未実装 / 実ファイルは作らない**)

> hookの新規作成・編集はSetaka承認 + QAクロスチェックが必要な対象のため、**本タスクでは設計提示までにとどめ、実ファイルは作成しない。** 実装は別途承認フローで行う。

目的: worker (実装役) がmainに直接書き込む / マージするコマンドを、実行前に遮断する。

- **種別**: PreToolUse hook (Bash matcher)。既存のBossガード (`guard-boss-no-impl.sh`) と同じ「identityで分岐して危険操作をexit 2でブロック」する作法に倣う。
- **発火条件 (遮断対象コマンド例)**:
  - `git push` でpush先が `main` (`git push origin main` / `git push origin HEAD:main` / refspecに `:main` / `:refs/heads/main`)
  - `git merge` 実行時に現在ブランチが `main`
  - `git branch -f main ...` / `git push --force` のmain対象
- **対象identity**: 実装worker (elxea-developer等)。Boss / 専用マージジョブidentityは素通り (層3の許可経路)。判定は既存identity lib (`hooks/lib/agent-identity.sh` 相当) を再利用。
- **fail方針**: 入力パース境界はfail-open (既存hookの方針に合わせ、malformed入力で全Bashを止めない)。判定成立時のみexit 2でブロックし、代替 (PRを出してBoss/QA経路でマージ) を案内する。
- **配置**: elxea側のhooks一式 (`~/.claude/hooks/` 配下)。elxeaエージェントのsettingsにPreToolUse (matcher: Bash) として登録。
- **多層防御**: hook (層2) はbranch protection (層1) と運用ルール (層3) を代替しない。3層を併用する。
