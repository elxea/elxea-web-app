# 検査の空回り監視 (Test Floor / 0件成功病)

対象事故: elxea「検証停止」(テストが実質動いていないのに通った扱いになった)
設計正本: circl-boss `deliverables/git-ops-proposal-final.md` のP5

---

## 1. 問題

テストが0件でもCIは "成功 (green)" と表示されうる。required status checksを必須化しても、そのgreenが「実質0件」なら検証は止まっている。AIエージェントは空振りを自分から申告しないため、外から「実際に実行したテスト件数が下限以上か」を機械で見張る必要がある。

## 2. 仕組み

スクリプト: `scripts/ops/check-test-floor.mjs`
CI配線: `.github/workflows/ci.yml` の `unit-tests` / `e2e-tests` ジョブ

各テストジョブがJUnit XMLを出力し、その **実行件数 (executed = tests − skipped)** が下限を下回ったらCIを失敗させる。ファイル不在・パース不能もそれ自体を「空回り」の兆候として失敗扱いにする。

| スイート | JUnitの出所 | 現在の下限 (env) | 導入時の実測目安 |
|---|---|---|---|
| unit | `pnpm test --project unit --reporter=junit --outputFile=test-results/junit.xml` | `TEST_FLOOR_UNIT=150` | ~460 test/it呼び出し |
| e2e | playwright `--reporter=junit` + `PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results/e2e-junit.xml` | `TEST_FLOOR_E2E=15` | CI実行分 ~54 (外部依存specはCIで除外) |

- 下限は「0件成功」という壊滅ケースを広いマージンで捕まえる値に設定している (偽陽性を避けるため実測より低め)。
- **運用**: テストが増えたらenvの下限を実測に近づけて締める。下げるのは原則禁止 (下げる = ガードを緩める)。

## 3. e2eのJUnit出力に関する修正

Playwrightの `--reporter=junit` は既定で **標準出力**に書く。ファイルに書くには `PLAYWRIGHT_JUNIT_OUTPUT_NAME` を設定する必要がある。従来の `--output=test-results/e2e-junit.xml` は *アーティファクト出力ディレクトリ*の指定であってJUnitファイルの指定ではなく、JUnitファイルは生成されていなかった。P5導入に合わせて `PLAYWRIGHT_JUNIT_OUTPUT_NAME` でファイル出力を確定し、アーティファクトは別ディレクトリ (`test-results/e2e-artifacts`) に分けた。

## 4. 対象外

- `storybook-tests` (a11y/interactionのビジュアルテスト) は件数が可変で「0件成功病」の主対象ではないため、今回の下限監視の対象外。必要なら同じ仕組みで追加できる。
