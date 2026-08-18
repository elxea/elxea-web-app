# mainへの直接書き込みを手元で止める仕組み (main-guard)

## なぜ手元でやるのか

GitHub側のブランチ保護 (branch protection / ruleset) が使えない。
`elxea` orgはfreeプランでリポジトリはprivateで、GitHubはこの組み合わせで
保護機能を課金ゲートしている。REST classic / REST rulesets / GraphQLの3経路とも
`403 "Upgrade to GitHub Pro or make this repository public to enable this feature."`
で拒否される (読み取りは通るので権限問題ではない)。費用はかけない判断のため、
同等の効果を手元のgit hookで作る。

現在 `DEPLOY_ENABLED=true` のため、**mainへのpushは即elxea.comへの本番配信**になる。

## 何が止まるか

| 操作 | 結果 |
|---|---|
| `main` にいる状態で `git commit` | 拒否 |
| `master` にいる状態で `git commit` | 拒否 |
| `main` の先端にdetached HEADで `git commit` | 拒否 |
| `git push origin main` | 拒否 |
| `git push origin HEAD:main` / `git push origin feat/x:main` | 拒否 (ローカルのブランチ名ではなくpush先で判定するため) |
| `git push origin :main` (mainの削除) | 拒否 |
| 作業ブランチでのcommit / push | 通る |
| push先が特定できない | 拒否 (fail-closed) |

## 構成 (2層)

| 層 | 実体 | 役割 |
|---|---|---|
| commitガード | `.pre-commit-config.yaml` のlocal hook `main-guard-commit` | main上でのcommitを止める |
| pushガード (本命) | `.git/hooks/pre-push.legacy` → `scripts/git-guard/pre-push-guard.sh` | mainへのpushを止める |
| pushガード (予備) | `.pre-commit-config.yaml` のlocal hook `main-guard-push` | 上が無い環境での二重化 |

判定ロジックは `scripts/git-guard/main-guard-lib.sh` の純関数 `mg_decide` に集約してあり、
`__tests__/git-guard/main-guard.test.ts` のunit testが赤経路を検証する。
本物のmainに触れずに「拒否されること」を証明するために、判断を副作用のない関数へ
切り出してある。

### なぜpushガードをpre-commitフレームワークに任せきりにしないか

実測で穴が見つかったため。pre-commitはpre-pushにおいて
**「リモートにまだ無いブランチを作るpush」かつ「積むcommitが既に別のremote refに存在する」**
場合、hookを1つも実行せずに終了する (`hook_impl` の `_pre_push_ns` が `None` を返し
その時点で0を返す)。このため `git push origin feat/x:main`
(作業ブランチをそのままmainに昇格させる操作) が素通りしていた。
これは本番配信が走る最も危険な操作なので、pre-commitの判定より手前で動く
legacy pre-push hookを本命に据えている。pre-commitは自身の判定に入る前にlegacy hookを
無条件で呼び、stdin (push先ref) もそのまま渡すため、この経路はスキップの影響を受けない。

## どう配られるか

hookの設置は `scripts/git-guard/install-hooks.sh` が行い、`package.json` の
`prepare` から呼ばれる。各自が手で有効化する運用にはしていない。

- **worktree**: gitは `.git/hooks` を全worktreeで共有するので、1回入れればこのリポの
  全worktreeに効く。worktreeごとの作業は不要
  (install-hooks.shは `--git-common-dir` を見て共通側に置く)
- **新しいclone**: `pnpm install` が `prepare` を走らせるので、依存を入れれば自動で有効になる
- **pre-commitが入っていない環境**: 生成済みhookは「pre-commitが見つからない」と言って
  終了コード1で落ちる。素通りにはならない
- **ガード本体が消えた環境**: `pre-push.legacy` のシムは
  `scripts/git-guard/pre-push-guard.sh` が実行できなければ拒否する (fail-closed)

手動で入れ直す場合:

```bash
bash scripts/git-guard/install-hooks.sh
```

## 緊急時に外す

外せる。ただし**外した事実が必ずリポジトリに残る**。

```bash
ELXEA_MAIN_GUARD_BYPASS="本番障害のホットフィックスのため" git commit -m "..."
```

理由だけでは通らない。ガードは監査ログ `docs/ops/main-guard-bypass-log.md` に
その理由が記録されているかを確認し、無ければ雛形を追記したうえで拒否する。

- commit時は **index** を見る → 記録をそのコミットに含めないと通らない
- push時は **HEAD** を見る → 記録がコミット済みでないと通らない

理由は10文字以上を要求する (「a」「緊急」で外せないようにするため)。

## 設定

| 環境変数 | 既定 | 用途 |
|---|---|---|
| `ELXEA_MAIN_GUARD_PROTECTED` | `main,master` | 保護対象ブランチ |
| `ELXEA_MAIN_GUARD_BYPASS` | (空) | 緊急バイパスの理由 |

## この仕組みで塞げないもの (正直な限界)

手元のhookである以上、以下はすり抜ける。**完全な防御ではない**。

1. **`git push --no-verify` / `git commit --no-verify`** — gitがhookを丸ごと飛ばす。
   運用ルールで禁止しているだけで、機械的には止まらない
2. **`SKIP=main-guard-commit`** — pre-commitフレームワークの標準スキップ機能
   (push側はlegacy hookが本命なので `SKIP` では外れない)
3. **GitHub Web UI / APIからの直接編集・マージ** — 手元を通らない
4. **hookを入れていないclone** — `pnpm install` を一度も走らせていない環境
5. **`core.hooksPath` の書き換え / `.git/hooks` の削除** — 手元の設定なので手元から壊せる
6. **CI / botからのpush** — Actionsの `GITHUB_TOKEN` によるpushは手元を通らない

これらを完全に塞ぐには、サーバー側 (GitHub有料プランのbranch protection) が必要。
CI側に検査を足せば3・4・6は**事後に検知**できる (下記)。

## CI側の補強案 (未実装 / 提案)

`.github/workflows/ci.yml` は他作業と競合するため本件では編集していない。
別PRで以下を足すと、手元をすり抜けたmainへの直pushを事後に検知できる。

```yaml
  # main に入った commit が PR 由来かを検査する
  guard-direct-push:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: main への直接 push を検知
        run: |
          for sha in $(git rev-list ${{ github.event.before }}..${{ github.sha }}); do
            n=$(gh api "repos/${{ github.repository }}/commits/$sha/pulls" --jq 'length')
            if [ "$n" -eq 0 ]; then
              echo "::error::$sha は PR を経由していません"
              exit 1
            fi
          done
        env:
          GH_TOKEN: ${{ github.token }}
```

これは**止める**のではなく**赤くして気づかせる**もの。止めるのはあくまで手元のhook。
