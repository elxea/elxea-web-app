# mainのブランチ保護 (Branch Protection) — 前提・費用・緊急バイパス

対象事故: elxea「本番 (main) への無審査の直接書き込み・古いままの合流」
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP1、`git-ops-review.md`

> **状態: 保留 (設定していない)。** GitHubプラン制約で現状は設定できないため、
> 本ドキュメントは「何が必要か・費用・有効化後の設定内容・緊急バイパス手順」を
> まとめ、Setakaの費用判断を仰ぐ。設定作業は費用承認後に行う。

---

## 1. 現状 (実測)

- リポジトリ `elxea/elxea-web-app` は **private**、所有はorg `elxea`。
- org `elxea` のプランは **GitHub Free** (`filled_seats: 1`)。
- この組み合わせでは **ブランチ保護 / rulesetsが使えない**。実測 (2026-08-17):
  - `GET repos/elxea/elxea-web-app/branches/main/protection` → `403 Upgrade to GitHub Pro or make this repository public`
  - `GET repos/elxea/elxea-web-app/rulesets` → 同上 `403`
- 結論: 提案の「コストほぼゼロ」はprivate + Freeでは成立しない (review指摘のとおり)。

## 2. 何が必要か・費用 (要Setaka判断)

privateリポでブランチ保護 / rulesetsを有効にするには、いずれか:

| 選択肢 | 内容 | 費用 | 妥当性 |
|---|---|---|---|
| **A. orgをGitHub Teamにアップグレード** | privateリポでブランチ保護 / rulesetsが有効化される | **約 $4 / user / 月 (年払い)**。orgは現在1 seatのため最小 ~$4/月 | **推奨**。最小コストでP1の機械強制が入る |
| B. リポをpublicにする | Freeでもブランチ保護が使える | $0 | **不可**。商用の非公開コードのため公開は不適 |
| C. 設定しない | 保護なしを継続 | $0 | P1の機械強制が入らず、層 (2)(3) (`merge-governance.md`) のみで担保 |

- 費用はGitHubの最新価格で要再確認 (本ドキュメント作成時点の概算)。
- Setakaは「有料化が必要なら費用提示可」と承認済み。**判断事項**: 選択肢Aで進めてよいか (費用 ~$4/月 を許容するか)。

## 3. 有効化後に適用する設定 (Team化後にそのまま実行)

`main` に対するrulesetを以下で作成する (rulesets推奨。classic branch protectionでも可)。**approval必須化は入れない** — 同一GitHubアカウント運用では自縄自縛になるため (review指摘。`merge-governance.md` §1)。

適用したい強制項目:
- 直接push禁止 (PR経由必須) = `pull_request` ルール
- required status checks = `static-checks` / `unit-tests` / `storybook-tests` / `e2e-tests` / `visual-regression`
- 「本流に追いついてから合流」= strict / up-to-date必須
- force push禁止・削除禁止
- required approving review count = **0** (承認は課金・契約系のみ。人手approvalに依存しない)

ready-to-run (Team化後に実行):

```bash
# rulesets 版 (推奨)。<...> は有効化後に調整。
gh api -X POST repos/elxea/elxea-web-app/rulesets \
  -f name='protect-main' -f target='branch' -f enforcement='active' \
  -F 'conditions[ref_name][include][]=refs/heads/main' \
  -F 'rules[][type]=deletion' \
  -F 'rules[][type]=non_fast_forward' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][type]=required_status_checks'
# required_status_checks の contexts (static-checks / unit-tests / storybook-tests /
# e2e-tests / visual-regression) と strict_required_status_checks_policy=true は
# JSON body で指定する (下記 §3.1 の JSON を --input で渡すのが確実)。
```

### 3.1確実版 (JSONを --inputで渡す)

```jsonc
// ruleset.json
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      } },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "static-checks" },
          { "context": "unit-tests" },
          { "context": "storybook-tests" },
          { "context": "e2e-tests" },
          { "context": "visual-regression" }
        ]
      } }
  ],
  "bypass_actors": []
}
```
```bash
gh api -X POST repos/elxea/elxea-web-app/rulesets --input ruleset.json
```

## 4. 緊急バイパス手順 (Emergency Hotfix / Shopify `/shipit --emergency` 相当)

保護は反映した瞬間から直pushを止める。イベント当日 (例: 8/23 marché) の障害時にprotectionが復旧を遅らせる側に回らないよう、**緊急経路をあらかじめ決めておく**。

原則: 緊急時も **PR経由を第一選択**にする (hotfixブランチ → PR → CI → squash merge)。CIが通れば数分。これで足りるケースが大半。

CIすら待てない真の緊急時のみ、以下のいずれか (実行はBoss判断・記録必須):

1. **rulesetを一時disable** → 直push → 即re-enable:
   ```bash
   # 事前に ruleset id を控えておく
   gh api repos/elxea/elxea-web-app/rulesets --jq '.[] | {id,name}'
   gh api -X PUT repos/elxea/elxea-web-app/rulesets/<id> -f enforcement='disabled'
   #  … hotfix を main に直 push …
   gh api -X PUT repos/elxea/elxea-web-app/rulesets/<id> -f enforcement='active'
   ```
2. **bypass actorを一時追加** (オーナー / 特定Appを `bypass_actors` に入れる) → hotfix → 除去。`enforcement='evaluate'` で影響確認してから使うと安全。

緊急経路を使ったら必ず: (a) 事後にDecision Log / Devlogへ記録、(b) hotfixを含む正規PRを追って残さない (mainと乖離させない)、(c) `docs/ops/production-source-of-truth.md` の監視で本番=mainの一致を確認。

## 5. 有効化までの代替担保

P1が有効化されるまでは、`docs/ops/merge-governance.md` の層 (2)(3) — workerのmain書き込み遮断hook (設計案) + マージ経路をQA通過後のBoss/専用ジョブに限定する運用 — が主担保になる。P1有効化後は3層併用になる。
