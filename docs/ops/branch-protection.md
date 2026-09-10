# mainのブランチ保護 (Branch Protection) — 前提・費用・緊急バイパス

対象事故: elxea「本番 (main) への無審査の直接書き込み・古いままの合流」
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP1、`git-ops-review.md`

> **状態: 有効 (2026-09-11 実測)。** 保護は classic branch protection として設定済みで、
> `enforce_admins` も有効。**本ドキュメントが前提にしていた「プラン制約で設定できない」は
> すでに成立しない** — リポジトリが public になったため、Free プランのままブランチ保護が使える。
> 現在の実測値は §1、実構成に対応する緊急バイパス手順は §4 を参照。
> §2 (費用判断) と §3 (有効化後に適用する設定) は、費用が争点だった当時の記録として残す。
> **§2 の判断は不要になった** ($0 で有効化済みのため)。

---

## 1. 現状 (実測 2026-09-11)

- リポジトリ `elxea/elxea-web-app` は **public**、所有はorg `elxea`。org のプランは **GitHub Free** (`filled_seats: 1`)。
- **public なので Free プランのままブランチ保護が使える。** 保護は **classic branch protection** で設定済み (rulesets は 0 件)。
- 実測値 (`gh api repos/elxea/elxea-web-app/branches/main/protection`):

  | 項目 | 値 |
  |---|---|
  | `enforce_admins` | **true** (2026-09-11 有効化) |
  | `required_status_checks.contexts` | `static-checks` / `unit-tests` / `coverage` / `build` / `storybook-tests` / `e2e-tests` / `identity-e2e` (7本) |
  | `required_status_checks.strict` | false (マージ前の main 追従は必須にしない) |
  | `required_approving_review_count` | 0 (人間のapprovalは不要) |
  | `allow_force_pushes` / `allow_deletions` | どちらも false |
  | rulesets (repo) | 0 件 (`GET /repos/.../rulesets` → `[]`) |

- **`enforce_admins` を有効化するエンドポイントは `POST`** であり `PUT` ではない。
  `PUT` はルート未定義のため **403 ではなく 404** が返る (2026-09-11 に実際に踏んだ)。
  権限不足と誤診しやすいので注意:

  ```bash
  # 有効化 (body 不要)
  gh api -X POST repos/elxea/elxea-web-app/branches/main/protection/enforce_admins
  # 確認
  gh api repos/elxea/elxea-web-app/branches/main/protection --jq .enforce_admins.enabled
  ```

- 履歴: 2026-08-17 時点ではリポジトリが private だったため `403 Upgrade to GitHub Pro or make this repository public` で保護が使えなかった。**その制約は public 化により消滅している。**

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

> **この手順は 2026-09-11 に実構成へ合わせて書き直した。** それまでは ruleset の
> 一時 disable を前提にしていたが、**実際の保護は classic branch protection で
> rulesets は 0 件**のため、旧手順は「id が引けず何も起きない」= 緊急時に使えない
> 状態だった (実測: `gh api .../rulesets --jq '.[] | {id,name}'` が空)。

1. **`enforce_admins` を一時解除** → 直push → 即再有効化 (推奨。影響範囲が最小):
   ```bash
   # 解除 (管理者だけが保護をすり抜けられる状態に戻す)
   gh api -X DELETE repos/elxea/elxea-web-app/branches/main/protection/enforce_admins
   #  … hotfix を main に直 push …
   # 即再有効化 (POST。PUT ではない)
   gh api -X POST repos/elxea/elxea-web-app/branches/main/protection/enforce_admins
   # 戻ったことを必ず確認する
   gh api repos/elxea/elxea-web-app/branches/main/protection --jq .enforce_admins.enabled  # → true
   ```
   必須チェック7本は解除されないので、**CIが赤いままのマージは依然できない**。
   「CIを待てない」のではなく「CIが赤いが出さねばならない」場合は次項を使う。

2. **保護そのものを一時解除** → hotfix → 即再適用 (最後の手段):
   ```bash
   # 現設定を必ず先に退避する (これが無いと復元できない)
   gh api repos/elxea/elxea-web-app/branches/main/protection > /tmp/main-protection-backup.json
   gh api -X DELETE repos/elxea/elxea-web-app/branches/main/protection
   #  … hotfix を main に直 push …
   # 復元 (退避した内容を PUT で戻す。フォーマット変換が要るため中身を確認してから流す)
   ```
   退避 JSON は GET と PUT でスキーマが異なる (GET は `contexts` を含むオブジェクト、
   PUT は `required_status_checks` / `enforce_admins` / `required_pull_request_reviews` /
   `restrictions` の4キーが必須で null 許容)。**そのまま流し込めない**ので、復元時は
   §3 の設定内容を正として組み立て直し、最後に §1 の実測表と突き合わせて確認する。

緊急経路を使ったら必ず: (a) 事後にDecision Log / Devlogへ記録、(b) hotfixを含む正規PRを追って残さない (mainと乖離させない)、(c) `docs/ops/production-source-of-truth.md` の監視で本番=mainの一致を確認。

## 5. 有効化までの代替担保

**P1は有効化済み (2026-09-11) のため、この節が想定していた「有効化までの繋ぎ」の期間は終わっている。**
現在は3層併用:

| 層 | 実体 | 止まる場所 |
|---|---|---|
| (1) ブランチ保護 (P1) | classic branch protection + `enforce_admins=true` + 必須チェック7本 | GitHub 側。**オーナーを含め誰も** main へ直push・赤マージができない |
| (2) ローカル pre-push | `.pre-commit-config.yaml` の pre-push stage (lint / typecheck / unit) | 手元。CIを待たずに同じ検査を落とせる「速い方の強制」 |
| (3) マージ経路の限定 | `docs/ops/merge-governance.md` の運用 | 人。QA通過後にBoss/専用ジョブがマージする |

(1)が入ったことで、(2)(3)は「唯一の強制」ではなく多層防御の一部になった。
