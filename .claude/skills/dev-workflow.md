# dev-workflow — roji開発工程の手順カード

elxea-web-app（roji）のフロントエンド実装に着手するとき・完了判定するときに読む。

**本カードは要約。判断に迷ったら正本を読む（二重記載しない）。**
正本 = roji Dev Ops Spec v1（承認済み2026-08-08 / Tier 2 Setaka）
https://app.notion.com/p/3b570c9d064c818fbee6f1dbeab63702

---

## 大前提（この2つは交渉不可）

### 1. Figmaが正本。コードはFigmaに追従する

Setaka宣言2026-08-08。値がずれていたら直す方向は**常に「コードをFigmaに合わせる」**。
逆向き（コードの値を根拠にFigmaを直す）は開発工程では行わない。
トークンを足す・変えるのは `tokens/base.json`（Figmaの写し）。

> ドリフト検査の向きもFigma → コードの一方向のみ。Figma側が壊れている（実装不能・矛盾）ときは
> **コードで辻褄を合わせず実装を止め、Boss経由でデザイン側へ差し戻す**。

### 2. 実装してよいのは凍結済みのページ・部品だけ

凍結（Setaka承認）前の先行実装は必ず作り直しになるため行わない。

- 凍結の正本 = `~/.claude/progress/design-freeze-pending.jsonl`（append-only。`~/.claude/hooks/guard-freeze-gate.sh` が機械的に止める）
- Structure DB（Structure List）の「ステータス：Design = Done」は**その投影であって正本ではない**。食い違ったら台帳ファイル側を正とする。
- 未凍結ページの実装を頼まれたら着手せず、Bossに「凍結待ち」と報告して戻す。

---

## 工程（Step 0-8）

| Step | やること | 終了条件 |
|---|---|---|
| 0 | **キュー確認** — Structure List（`collection://9838311b-ddb0-4e0f-ac89-774a36c59b04`）のroji行から次の1ページを取る。列 = 「Design = DoneかつDevがDoneでない行」 | 対象1行が特定できている |
| 1 | **凍結確認** — 凍結台帳で当該ページが凍結済みであることを確認する | 凍結済みを確認できた |
| 2 | **ブランチ** — mainから切る（mainへの直接push禁止）。着手前にmainを取り込む | main相当の最新から派生している |
| 3 | **実装** — 編集先は `scripts/design-system/design-map.json`（Figma node ⇄ code path対応表）で特定する。勘でファイルを探さない。値はトークン経由のみ（生の色・px直書き / 任意値クラス `bg-[...]` 禁止）。shadcn/ui + CVA + `cn()` の既存作法に従う | ローカルで表示できる |
| 4 | **忠実度対比** — Figma実測値vs実画面 `getComputedStyle` 実測値の数表を作る（font-size / line-height / letter-spacing / font-weight / コンテナ幅 / grid列数・gap / セクション余白 / 色）。差分は【仕様】【粗】【要判断】に3分類する | 粗0件（要判断はReviewタスクに切り出せば先へ進んでよい） |
| 5 | **機械検証** — 下記コマンドを全件実行しFAIL 0。サンプリングしない | 全PASS |
| 6 | **pre-push** — ローカル関門を通す（下記「pre-push」節） | pre-pushが通る |
| 7 | **PR + QAゲート** — PRに忠実度対比の数表と機械検証結果を必ず添える。実装者とは別エージェント（`elxea-qa`）が忠実度監査。自己申告だけの完了は不可。差し戻しは最大2回、2回失敗でSetakaへエスカレーション | CI全PASSかつQAゲート合格 |
| 8 | **Structure DB更新** — マージ後、当該行の「ステータス：Dev」をDoneにする | 台帳の状態が実コードと一致 |

### Step 5の機械検証コマンド（全件・FAIL 0）

```bash
pnpm typecheck                   # 型（stale .next/types をクリア → next typegen → tsc --noEmit）
pnpm lint                        # ESLint --max-warnings 0
pnpm test                        # vitest run（--project unit / --project storybook で個別実行可）
pnpm validate:tokens             # トークン定義 ⇄ 生成 CSS 変数
pnpm validate:design-map         # Figma node ⇄ code path の実在（--figma で node 生存も）
pnpm validate:design-kit         # design-kit 生成物と手書き定義の整合
pnpm build                       # トークン再生成 + 本番ビルド
```

### pre-push（as-built）

pre-commitフレームワーク経由で `lint` / `typecheck` / `unit test` を強制する（`.pre-commit-config.yaml`）。
無料プランでbranch protectionを張れないため、**これが実質的な最終関門**。設定を外さないこと。

```bash
pre-commit install --hook-type pre-commit --hook-type pre-push   # 2 stage 両方必要
pre-commit run --hook-stage pre-push -a                          # 手動実行
```

> 正本Spec §3はpre-pushを「整備予定」と書いているが、2026-08-07のP0整備（J-2b）で導入済み。
> Spec側の当該行は次版でas-built化する。

---

## 完了定義（5点。1つでも欠けたら未完了）

1. 忠実度対比がPASS（Figma実測vs実画面実測の数表を提出）
2. 型チェック・Lint・単体テストがPASS
3. 変更したコンポーネントがStorybookに反映されている
4. ページの見た目比較（VRT）の基準画像が更新されている
5. Structure DB（Structure List）の実装ステータスが更新されている

**スクリーンショットの目視だけの検証は不合格**（数値差分がすり抜けた実例があるため）。

### 完了報告のEVIDENCE形式

```
EVIDENCE: command:<実行コマンド>:<FAIL 件数>
EVIDENCE: fidelity:<結果ファイルの絶対パス>:<FAIL 件数>   # 忠実度対比の機械化後
```

---

## 変更管理・異常時（要点のみ。詳細は正本 §5 / §6）

- 実装中にFigmaが更新されたら**実装を止めて再凍結を待つ**。再凍結されたらStep 0から入り直す。
- チャット・口頭の「ちょっとここだけ直して」は変更経路ではない。デザイン変更はデザイン工程に戻す。
- 「Figmaと意図的に異なる」承認済み仕様差分の一覧は本リポ `CLAUDE.md` の表が正本。監査はこれを【仕様】として扱う。表に足すときは**先にDecision Logに記録**する。
- 同じ原因で3回失敗したらBossへ。同一の失敗を繰り返すループに入らない。
- トークンが足りなくて直書きしたくなったら、**トークンを追加してから使う**。

---

## 関連

| 参照先 | 内容 |
|---|---|
| https://app.notion.com/p/3b570c9d064c818fbee6f1dbeab63702 | roji Dev Ops Spec v1（本カードの正本） |
| https://www.notion.so/39070c9d064c8148b983f9004c85fc3d | Design Ops Spec（デザイン側の正本） |
| `CLAUDE.md` | 本リポのSoT方針・忠実度ゲート・承認済み仕様差分の表 |
| `.claude/skills/design-tokens.md` | トークンの編集・ビルド・検証 |
| `.claude/skills/figma-sync.md` | Figma ⇄ コード同期の実務 |
| `.claude/skills/visual-qa.md` | ビジュアル品質チェックリスト |
