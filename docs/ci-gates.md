# CIゲートと運用ルール

このリポジトリのCIが「何を検査し、何を検査していないか」と、CI結果をどう扱うかの正本。
配線は `.github/workflows/ci.yml` / `vitest.config.ts` / `playwright.config.ts` がSoTで、
本ドキュメントはその意図と運用側のルールを書く。

最終更新: 2026-08-09 (品質保証プランP0)

---

## マージ規則 (3行)

- **`main` へのマージはCIが緑になったことをBossが確認してから行う。** 赤 / 未実行のままマージしない。
- **branch protectionは張れない** (GitHub Free + private repoではrequired status checksが有料機能。
  `gh api repos/elxea/elxea-web-app/branches/main/protection` は403 `Upgrade to GitHub Pro` を返す)。
  よってCIは**検査と可視化**までしか担保せず、**マージを止めるのは運用 (Bossの確認) のみ**。
- 確認コマンド: `gh run list --branch <branch> --limit 5` で当該コミットのconclusionが `success` であること。

---

## いつ何が走るか

| job | `feat/**` push | PR (全base) | `main` / `developer` push | 内容 |
|---|---|---|---|---|
| `static-checks` | 実行 | 実行 | 実行 | `lint` → `typecheck` → `validate:tokens` → `validate:design-map` → `validate:design-kit` |
| `unit-tests` | 実行 | 実行 | 実行 | `vitest --project unit` (JUnitをartifact化) |
| `coverage` | 実行 | 実行 | 実行 | `pnpm test:coverage`。閾値割れでFAIL |
| `build` | 実行 | 実行 | 実行 | `pnpm build` (`PREVIEW_SEED=1`) |
| `storybook-tests` | 実行 | 実行 | 実行 | storyのinteraction + axe。a11y違反でFAIL |
| `e2e-tests` | 実行 | 実行 | 実行 | Playwright (chromium)。skip件数をjob summaryに出す |
| `visual-regression` | 走らない | 実行 | 走らない | Chromatic。スナップショット課金のためPR限定 |
| `staging-smoke` | 走らない | 走らない | `main` のみ | `STAGING_URL` 未設定ならgraceful skip |

`push` は **docsのみの変更 (`**/*.md` / `docs/**` / `LICENSE`) では走らない**
(このブランチのコミットの約21% が対比表markdownのため。PRは絞り込みなしで全部走る)。

### 実行時間の予算 (無料枠を使い切らないための数字)

private repoのActionsは**分課金**で、GitHub Freeの無料枠は **2,000分/月**
(枠の現在値はSettings > Billingが正。ここの数字は執筆時点の前提)。
`feat/**` push 1回あたりの請求分は、**ジョブ単位でwall clockを分に切り上げた合計**:

| job | 実測wall clock | 請求分 (切り上げ) |
|---|---|---|
| `static-checks` | 88s | 2 |
| `unit-tests` | 46s | 1 |
| `coverage` | 53s | 1 |
| `storybook-tests` | 133s | 3 |
| `build` | 105s | 2 |
| `e2e-tests` | 309s | 6 |
| **合計 (緑のpush)** | **734s** | **15分** |

出典: run 31326097580 (2026-08-09 / 全job緑 / 各jobの `started_at`〜`completed_at` 実測)。
**e2eが赤いpushは高くつく** — `--retries=2` で失敗ケースを3回走らせるため、
同ブランチの赤いrun 31325550936ではe2eが581s (10分) に伸び、pushあたり **19分** になった。

つまり **緑なら月133 push / 赤が混ざると月105 push** で無料枠に当たる。
月30日で割ると **持続可能なのは1日4〜5 push**。1日20 pushのペースなら**1週間で使い切る**
(20 x 7 x 15分 = 2,100分)。今回のP0作業のように1セッションで5〜6 push積む使い方は、
それだけで1日の予算をほぼ使う。余裕は「たっぷり」ではない。

超過リスクが出たときの緩和策 (**1〜3は現時点で配線済み**):

1. **`paths-ignore` (配線済み)** — docsのみのpushは0分。対比表markdownが多いこのブランチでは効きが大きい。
2. **`concurrency: cancel-in-progress` (配線済み)** — 同じrefへ連続pushすると走行中のrunを打ち切る。
   連投時に古いrunの残り分を払わない。
3. **`visual-regression` はPR限定 (配線済み)** — Chromaticはスナップショット課金なので `feat/**` pushでは走らせない。
4. (未配線・必要になったら) `e2e-tests` の `--retries` を1に下げる / PR時のみ2にする。
   retriesは**flakyの隠蔽と分の消費を同時に増やす**ので、下げる判断は品質側とセットで行う。

判断の順序: **まず `paths-ignore` の網羅を確認 → 次にpush頻度 → 最後にジョブ削減**。
「ジョブを消して分を節約する」は検査を捨てることなので最後に置く。

### 2026-08-09に直したこと

1. **`feat/**` でCIが1度も走っていなかった** — triggerが `main` / `developer` / `PR to main` だけで、
   作業ブランチが対象外。`feat/c1-ds-foundation` は **150 commit超**
   (`git rev-list --count origin/main..174a237` = 158 / 2026-08-10実測) 先行しながらCI未通過だった。
   件数はコミットが積まれるたびに動く。**引用するときは必ず測った時点のSHAを添える**
   — 素の「N件」表記は書いた瞬間から古くなる。設定の差ではなくtriggerの穴。
2. **`build` ゲートが無かった** — 初回のビルド検証が `deploy.yml` の `vercel build --prod` = **マージ後**。
   壊れたビルドが本番デプロイで判明する状態だった。
3. **CIのtypecheckが手元と別物だった** — CIは `pnpm tsc --noEmit`、pre-pushは `pnpm typecheck`
   (`next typegen` 込み)。生成ルート型に依存する型エラーがCIをすり抜けていた。`pnpm typecheck` に統一。
4. **カバレッジが未計測だった** — `@vitest/coverage-v8` はdevDepにあるだけ。閾値付きで配線。
5. **skipが緑と区別できなかった** — 下記。
6. **見本写真が実行ごとに入れ替わりスクショ比較が成立しなかった** — 下記。

---

## no-op緑 (何も検証せず緑になるテスト)

E2Eには実行時skipガードが多数ある。例:

```ts
test.skip(!process.env.CRON_SECRET, "CRON_SECRET が設定されていません");
```

CIはこれらのsecretをほぼ注入していないので、**該当ケースは自分をskipしてjobは緑になる**。
Playwrightのコンソール行には件数が出るがjobの成否には出ないため、
「e2e-tests: passed」が「定期便フローは動く」と読まれてしまう。実際には1行も走っていない。

対処は **可視化のみ**:

- `scripts/ci/e2e-skip-summary.mjs` がPlaywrightのJSONレポートを読み、
  **skip件数と理由**をjob summaryに表 (理由でグルーピング + 全件明細) で出す。
- **ビルドは落とさない / skipを勝手に有効化もしない。** 有効化にはsecret投入が必要で、それは別判断。
- 理由文字列の無い `test.skip()` は全廃した。恒久skipも
  `test(...)` + 先頭 `test.skip(true, 理由)` の形にして**理由がannotationに載る**ようにしてある
  (`test.skip("title", fn)` 形式は理由を記録できず、summary上「理由未記載」になる)。

### skipを解除するのに必要なsecret / 前提

**このタスクでは追加していない** (ghは読み取りのみ)。投入はSetaka判断。
現在repoに存在するsecretは `CHROMATIC_PROJECT_TOKEN` / `VERCEL_TOKEN` の2件のみ。

| secret / 前提 | これが無いとskipされるもの | 種別 |
|---|---|---|
| `CRON_SECRET` | 定期便の課金cron呼び出し検証 (`subscription-management`) | repo secret |
| `SHOPIFY_WEBHOOK_SECRET` | Shopify webhookのHMAC検証 (`subscription-management`) | repo secret |
| `SHOPIFY_WEBHOOK_URL` | webhook送信先を叩くケース (`ms7-personalization`) | repo secret |
| `AGENT_BASE_URL` | エージェントAPI経由のケース (`ms7-personalization`) | repo secret |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin APIを使う前提整備 | repo secret |
| `TEST_SHOPIFY_CUSTOMER_ID` / `TEST_SHOPIFY_SESSION_TOKEN` | ログイン済み前提のケース (`ms7-personalization`) | repo secret |
| `STAGING_URL` | `staging-smoke` job全体 (未設定時はgraceful skip) | repo secret |
| SellingPlan商品 / 在庫あり商品 / 公開記事 | 定期便申込 (17箇所)・商品詳細・ジャーナル系の実行時skip | **secretではなくデータ前提** |
| `/ja/liff` ルート実装 | LIFFページ4件 (恒久skip) | **実装待ち** |

`E2E_ALLOW_SKIP=1` は `e2e/support/preconditions.ts` の明示的な逃げ道で、**CIでは設定しない**
(設定すると前提不足が失敗ではなくskipに化ける)。

---

## カバレッジ

`pnpm test:coverage` (= `VITEST_COVERAGE=1 vitest run --project unit`)。

- **`--coverage` のCLIフラグは使えない。** `@chromatic-com/storybook` プリセットのロード中に
  同梱の `chromatic` CLIが `process.argv` を読み、booleanの `true` に `.provider` を代入しようとして
  `TypeError` を投げ、`SB_CORE-SERVER_0002 CriticalPresetLoadError` で**テストが1件も走らずに全滅する**
  (`--project unit` を付けても設定ロード時点で落ちる)。env var経由にしてあるのはこれを避けるため。
- **スコープ**: `lib/**` + `app/api/**` + `sanity/lib/**`。Reactコンポーネントは `storybook` project
  (別ランナー) が担保するので含めない (含めると ~146ファイル0% で信号が埋まる)。
- **`include` を明示しているのが要点。** Vitestの既定は「テストがimportしたファイルだけ」なので、
  未テストのファイルを新規追加してもレポートに現れず**率が下がらない**。それではこのゲートの目的
  (誰も気づかないまま減っていく状態を止める) を果たせない。
  (Vitest 3では `coverage.all: true` が必要だった。Vitest 4で当該オプションは削除され、`include` 単体で同じ挙動になる)
- **閾値は「CIでの実測値」を1桁切り捨ててpinする** (`vitest.config.ts` の `thresholds` が正)。
  ローカル (macOS) とCI (ubuntu) では `lib/` 配下のenv依存分岐が別経路を通るため
  branchesが数値でずれる。**ゲートが走るのはCIなので、pinもCIの数値に合わせる。**

  | 指標 | pin (`vitest.config.ts`) | pin根拠のCI実測 (run 31322772252) | 現在のCI実測 (run 31326097580) |
  |---|---|---|---|
  | statements | 22.3 | 22.31% (668/2994) | 22.72% (688/3028) |
  | branches | **25.3** | 25.32% (470/1856) | 25.5% (480/1882) |
  | functions | 23.3 | 23.35% (110/471) | 24.79% (120/484) |
  | lines | 22.0 | 22.09% (611/2765) | 22.44% (627/2793) |

  **これは「22% で十分」という主張ではなくラチェット**。下がったら落ちる。テストを足したら上げる。
  **赤を緑にするために下げてはいけない。** 分母が増える (新規ファイルを足す) ときは、
  同じコミットで単体テストも足して率を維持するのが唯一の正しい進め方
  (例: `lib/preview-seed-storefront.ts` 追加時に `__tests__/preview-seed-storefront.test.ts` を同梱し、
  4指標すべてを上げた)。

現状の空白 (数値の裏にあるもの): API route 38本のうち直接テストは2本。cron 4本 (課金・リマインド・
農家通知・ログ掃除) は単体テスト0件で、E2E側も `CRON_SECRET` 未注入でskip = **課金経路が自動検証の外**。

---

## buildゲート

`pnpm build` = `node sd.config.mjs && tsx scripts/check-placeholders.ts && next build`。
トークン生成とプレースホルダ検査も同時に通る。

CIが渡すenv:

| 変数 | 値 | 理由 |
|---|---|---|
| `PREVIEW_SEED` | `1` | 見本データで実密度のままprerenderさせる |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` | 公開値 | secretではない。`e2e-tests` と同値 |
| `SESSION_SECRET` | 使い捨ての固定文字列 (workflow全体の `env` で定義) | **credentialではない。** `lib/shopify/customer.ts` がmodule load時に空文字でhard-failするため、非空である必要だけがある。実値はVercelのproject env側 |

`SESSION_SECRET` は `build` と `e2e-tests` の両方が必要とする (理由が違う):

- `build`: `next build` が `/api/auth/logout` の "Collecting page data" で落ちる
- `e2e-tests`: Playwrightの `webServer` が `pnpm dev` を起動し `process.env` を継承する。未設定だと **全ルートが500になりE2Eがまるごと落ちる** (run 31321859910の41 failureは全てこれが原因)

---

## 見本写真の決定論フラグ

`PREVIEW_SEED_DETERMINISTIC=1` (`lib/preview-seed.ts`)。

プレースホルダ写真の選択は**キー単位では決定的**だが、キー自体が実行ごとに変わる:
見本ページは「実写真を持たないドキュメント」だけプレースホルダに落ちる作りで、
参照先がliveのproduction Sanity datasetなので、その内容が動くとidの構成 = どの写真が何枚出るかが動く。
プールが3種のアスペクト比 (1920x1200 / 1920x1440 / 1024x1024) を含むため、
これが**総ページ高を動かす**。C16-1で `journal__sp` / `elxea-journal__sp` が
**同一コードの2回の実行で52,422 pxと51,889 px** になり、検出したい2〜3 pxの差分が埋まった。

このフラグを立てると全キーが `PREVIEW_IMAGES[0]` に解決するので、
どのドキュメントが返ってきたかにページ高が依存しなくなる。レイアウト・余白の実測値には影響しない。
**見本ページを目で確認するときはOFFにする** (全部同じ写真になるため)。

既定 (フラグ未設定) の挙動は従来とbyte-identical。

---

## CIに無いもの (現時点で意図的に未着手)

- **gitleaks / shellcheck** — `.pre-commit-config.yaml` にあり**ローカルのみ**。他マシン・CIではsecretが素通りする
- **クロスブラウザ** — `playwright.config.ts` に `projects` が無くchromium単独。WebKit (iOS Safari) 検証は0件
- **ページ単位のa11y** — axeはStorybook経由で部品にのみ強制。組み上がったページ (45ページ) には未適用
- **パフォーマンス** — Lighthouse / web-vitals / バンドルサイズ予算いずれも無し
- **忠実度の回帰検査** — `docs/fidelity/` の対比表20本は人手。`scripts/c*-measure.mjs` 9本はCI外
