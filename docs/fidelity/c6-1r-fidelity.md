# C6-1R忠実度対比表 — `destructive` をFigma実在値へ戻す

対象: `tokens/base.json` の `destructive` トークンと、その全使用箇所。
Figma: 【R2: 確定版】AuthErrorBanner `5344:3` (状態枠 `6706:14468`) / file `AWLnI0XF07e8rScuxPYPc7`
親タスク: https://app.notion.com/p/3b570c9d064c81159806c3b9c8b0d74a
QA指摘元: https://app.notion.com/p/3b670c9d064c81dca525f395d95c0935
計測日時: 2026-08-09 01:00-01:10 JST

## 0. 結論

| 項目 | before | after |
|---|---|---|
| `color.semantic.destructive` | `oklch(0.572 0.133 16.4)` = **#b9525c** (Figmaに無い値) | `oklch(0.537 0.135 17)` = **#ae4751** (Figma Variable `destructive` の実値) |
| `elevation.focus.ringColor.destructive` | `oklch(0.572 0.133 16.4)` | `oklch(0.537 0.135 17)` (semanticと同値に揃えた。注4) |
| ログイン状態バナーの文字対比 (面 `background` #ebe9e0) | **3.896:1** → WCAG AA (4.5:1) **未達** | **4.52:1** → **合格** (ブラウザ実測) |
| destructive使用箇所の判定 | 19組合せ中 **13 FAIL** | 19組合せ中 **2 FAIL** (J1 / L2。いずれもFigma値では解けないDS案件。§2注2) |

Figma実測 (独立再確認): `mcp__figma__get_variable_defs(fileKey=AWLnI0XF07e8rScuxPYPc7, nodeId=5344:3)`
→ `{"destructive":"#ae4751", ..., "background":"#ebe9e0"}`。QAの実測と一致。

## 1. なぜ「コード側をFigmaに合わせる」のか

`card` の是正 (C5-1) と同じ前例に従う。**色はFigmaを正本**とし、コードのドリフトは
コード側を直す。今回はAA未達の解消とFigma一致が同じ方向を向いており、
「Figmaを破ってコントラストを稼ぐ」判断は不要だった。

`oklch(0.537 0.135 17)` は #ae4751に**厳密に往復一致**する
(`tokens/config.mjs` の `hexToOklch` で #ae4751 → `oklch(0.537 0.135 17)`、
逆変換でsRGB 8bit `(174, 71, 81)` = #ae4751)。丸め由来のズレは無い。
Vercel Preview上の実測でも `--color-destructive` の解決値は **#ae4751** (canvasピクセル読み)。

## 2. destructive全使用箇所のbefore/afterコントラスト実測

### 計測方法 (canvasピクセル実測)

**`getComputedStyle()` の文字列を自前で数値パースしてはいけない。** 本リポのトークンは
`oklch()` で定義しているため、現行Chromiumの計算値は `lab(44.8316% 43.5747 16.7374)` の
ような**広色域の色空間表記**で返る。`rgb()` 前提の正規表現で数値を拾うと、
そのまま「面色 #5c0005 / 対比1.01:1」のような**完全な嘘の値**が出る (実際に1回踏んだ)。

そこで **1x1 canvasに実際に塗って `getImageData` でピクセルを読む**方式に切り替えた。
ブラウザ自身の色変換を通るので、色空間表記でもアルファ合成でも必ず正しいsRGB 8bitが得られる。

```js
const c2 = canvas.getContext('2d', { willReadFrequently: true });
c2.globalCompositeOperation = 'copy';       // 前の塗りを持ち越さない
c2.fillStyle = '#000'; c2.fillStyle = cssColorString;  // 無効値は #000 に落ちるので検出できる
c2.fillRect(0, 0, 1, 1);
const [r, g, b, a255] = c2.getImageData(0, 0, 1, 1).data;   // 真の sRGB
```

- 対比はWCAG 2.xの相対輝度 (`0.2126R + 0.7152G + 0.0722B` を線形化後に適用) から
  `(L_lighter + 0.05) / (L_darker + 0.05)`。小数第3位まで出す (丸めで境界をまたがせない)。
- 面色は**半透明の祖先を合成して**求める (チャットパネルの `bg-background/80` 等)。
- 不透明度つきユーティリティ (`/90` `/40` `/20` `/10`) は **Tailwind v4がoklabで混色する**
  (`color-mix(in oklab, …)`)。sRGBでアルファ合成した自前計算より **0.01-0.02高く出る**ため、
  下表の合成値は**ブラウザ実測を正**とした (例: `/90` は自前4.162に対しブラウザ4.177)。
- 閾値: **テキスト4.5:1 / 非テキスト (罫線・アイコン・境界指示) 3:1**。

面色の実測値 (Preview): `background` = `popover` = `muted` = **#ebe9e0** / `card` = **#f4f3ed** /
`destructive-foreground` = **#ffffff**。

### 実測表

| # | 使用箇所 | 前景 (実効色) | 面色 | before比 | after比 | 閾値 | before | after |
|---|---|---|---|---|---|---|---|---|
| A1 | ログイン状態バナー 文字 (`auth-card.tsx` AuthCardBanner tone=error) | `text-destructive` #b9525c → **#ae4751** | `background` #ebe9e0 | 3.896 | **4.52** | 4.5:1 | [FAIL] | **[OK]** |
| A2 | ログイン状態バナー 罫線 | `border-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | 4.52 | 3:1 | [OK] | [OK] |
| B1 | Alert variant=destructiveタイトル | `text-destructive` #b9525c → #ae4751 | `card` #f4f3ed | 4.261 | **4.945** | 4.5:1 | [FAIL] | **[OK]** |
| B2 | Alert variant=destructive本文 | `text-destructive/90` → **不透明度を撤去** #ae4751 | `card` #f4f3ed | 3.644 | **4.945** | 4.5:1 | [FAIL] | **[OK]** 注1 |
| B3 | Alert variant=destructiveアイコン (`[&>svg]:text-current`) | `text-destructive` #b9525c → #ae4751 | `card` #f4f3ed | 4.261 | 4.945 | 3:1 | [OK] | [OK] |
| C1 | Button variant=destructiveの文字 | `text-destructive-foreground` #ffffff | 面が `destructive` #b9525c → #ae4751 | 4.741 | **5.498** | 4.5:1 | [OK] | [OK] |
| D1 | Badge variant=destructiveの文字 (商品「売り切れ」等) | `text-destructive-foreground` #ffffff | 面が `destructive` #b9525c → #ae4751 | 4.741 | **5.498** | 4.5:1 | [OK] | [OK] |
| E1 | パスワードゲート エラー文字 (`app/password/page.tsx`) | `text-destructive` #b9525c → #ae4751 | `card` #f4f3ed | 4.261 | **4.945** | 4.5:1 | [FAIL] | **[OK]** |
| E2 | パスワードゲート エラー枠 | `border-destructive/40` → **不透明度を撤去** #ae4751 | `card` #f4f3ed | 1.697 | **4.945** | 3:1 | [FAIL] | **[OK]** 注1 |
| F1 | FormMessage / FieldError (フォームが背景直置き) | `text-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | **4.52** | 4.5:1 | [FAIL] | **[OK]** |
| F2 | FormMessage / FieldError (フォームがカード内) | `text-destructive` #b9525c → #ae4751 | `card` #f4f3ed | 4.261 | **4.945** | 4.5:1 | [FAIL] | **[OK]** |
| G1 | お問い合わせ / 法人 / テイスティングノート 送信エラー | `text-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | **4.52** | 4.5:1 | [FAIL] | **[OK]** |
| H1 | 定期便 操作エラー (`subscription-actions.tsx`) | `text-destructive` #b9525c → #ae4751 | `card` #f4f3ed | 4.261 | **4.945** | 4.5:1 | [FAIL] | **[OK]** |
| I1 | コメント文字数オーバー カウンタ | `text-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | **4.52** | 4.5:1 | [FAIL] | **[OK]** |
| I2 | コメント文字数オーバーtextarea罫線 | `border-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | 4.52 | 3:1 | [OK] | [OK] |
| J1 | チャット 低評価「選択中」の文字 (面が `destructive/10`) | `text-destructive` #b9525c → #ae4751 | 合成面 #e6dad3 → **#e4d8d1** | 3.458 | **3.946** | 4.5:1 | [FAIL] | **[FAIL]** 注2 |
| K1 | `aria-invalid` の入力枠 (input / textarea / select / checkbox / radio / combobox / otp / badge / button / toggle) | `border-destructive` #b9525c → #ae4751 | `background` #ebe9e0 | 3.896 | 4.52 | 3:1 | [OK] | [OK] |
| K2 | `aria-invalid` のリング | `ring-destructive/20` → #dfc8c3 | `background` #ebe9e0 | 1.275 | 1.305 | — | [情報] | [情報] 注3 |
| L1 | メニュー項目variant=destructive文字 (dropdown / context / menubar) | `text-destructive` #b9525c → #ae4751 | `popover` #ebe9e0 | 3.896 | **4.52** | 4.5:1 | [FAIL] | **[OK]** |
| L2 | 同 フォーカス時 (面が `destructive/10`) の文字 | `text-destructive` #b9525c → #ae4751 | 合成面 #e6dad3 → **#e4d8d1** | 3.458 | **3.946** | 4.5:1 | [FAIL] | **[FAIL]** 注2 |

after比はVercel Preview上のブラウザ実測 (canvas)。before比のうち**不透明度なしの行**は
同じ計算式に旧トークン #b9525cを入れた値 (混色を伴わないので実測と厳密一致する)。
**不透明度つきのbefore行** (B2 / E2 / K2) はsRGB合成での近似値なので **±0.02の幅**がある
(oklab混色だとB2 = 3.66前後 / E2 = 1.79前後)。閾値からの距離が大きく判定は変わらない。

集計: before **13 FAIL** (A1 / B1 / B2 / E1 / E2 / F1 / F2 / G1 / H1 / I1 / J1 / L1 / L2) →
after **2 FAIL** (J1 / L2)。
**トークンの差し替えだけで直った**のはA1 / B1 / E1 / F1 / F2 / G1 / H1 / I1 / L1の **9件**。
残り2件 (B2 / E2) は不透明度の撤去で直した (注1)。

注1: **本レーンで不透明度を撤去した2件**。`text-destructive/90` (Alert本文) と
`border-destructive/40` (パスワードゲートの枠) はshadcn既定の「トーンを弱めるためだけの」
不透明度で、意味を担っていない。**新トークンにしても合成後は4.177:1 / 1.785:1で閾値未達**
(ブラウザ実測) だったため100% に戻した (どちらも4.945:1で合格)。
Figma側に該当する不透明度指定は無いので忠実度の後退は無い。
**見た目が変わる範囲**: (a) Alertのdestructiveバリアントの説明文がわずかに濃くなる
(#b55860 → #ae4751)。ただしAlert destructiveは**実画面では未使用**でStorybookのみ
(`components/ui/alert.stories.tsx` / `stories/ActiveComponents.stories.tsx`)。
(b) `/password` の誤入力エラー枠が薄いピンク #d8aeaeから #ae4751に変わり**はっきり見える**
ようになる。これは開発用パスワードゲートで、顧客向け画面ではない。

注2: **残る未達2件 (J1 / L2) は本レーンで直さない**。どちらも
「`destructive` の文字を `destructive/10` で薄く塗った面の上に置く」というshadcn共通の
パターンで、**Figma値のままでは3.946:1と0.55足りない**。解くには
(a) `destructive` をFigmaより暗くする = 今回の是正 (Figma一致) を自分で壊す、
(b) destructive文字の背後の淡い塗りをやめる = DS全域の選択状態・フォーカス表現の設計変更、
のどちらかが必要で、いずれも1レーンで決める話ではない。
**DSトークン整合タスク `3b670c9d-064c-8166` の対象**として送る (§4 Q1)。
なおJ1の実際の面はチャットパネルが `bg-background/80 backdrop-blur-xl` (半透明) なので、
表の値は「背後が `background` 単色のとき」の代表値。

注3: K2は**違反として数えない**。`aria-invalid` の境界指示は同時に当たる
`border-destructive` (K1 = 4.52:1 / 閾値3:1合格) が担っており、`ring-destructive/20` は
その外側の装飾グロー。WCAG 1.4.11が求める「状態を伝える視覚的指示」はK1で満たされている。
分類を [情報] にした (値そのものは変えていない)。

注4: `elevation.focus.ringColor.destructive` はsemanticと同値に揃えたが、
**現状ランタイムに出ていない**。Preview上で `--elevation-focus-ringColor-destructive` を
引くと空文字で、CSS本文にも現れない (Tailwind v4の `@theme` は未使用変数を落とす。
実際どのコンポーネントも参照せず `ring-destructive/*` を直接使っている)。
design-kitの `known_gaps[gap-focus-binding]` が指すとおりの未束縛状態。
今回の更新は**トークン定義の内部整合**のためで、画面への効果は無い。

## 3. 触っていない・意図して残した差分

| 対象 | 現状 | 触らなかった理由 |
|---|---|---|
| `tokens/base.json` の `brand.tea-red` | #b9525cのまま (`destructive` とは別トークン) | ジャーナルのカテゴリ色「茜」(`var(--color-brand-tea-red)`) として使われる**別の役割**。Figmaの `destructive` variableの実測はsemantic側の根拠にしかならないので、ブランドパレット側の実測なしに動かさない。結果としてsemantic `destructive` (#ae4751) と `brand.tea-red` (#b9525c) は**意図的に別値**になった |
| `tokens/elxea-custom.json` の `destructive` (light #b9525c / dark明色版) | 変更なし | `sd.config.mjs` の `source` に入っておらず**ビルドされない**参考資料 (CLAUDE.md 93行目 / design-kit `conflicts[c-01]`)。かつdark値は旧light値から導出されているためlightだけ直すと対が壊れる。正本扱いしない方針を維持 |
| `stories/tokens/Colors.stories.tsx` の色見本 | 19トークン全部がshadcn既定値のまま (`destructive` は `oklch(0.577 0.245 27.325)`)、`cssVar` も `--color-semantic-*` で実在しない名前 | destructive 1行だけ直しても表全体が嘘のままなので、**全体を別途作り直す案件**として送る (§4 Q3) |
| `scripts/design-system/design-kit.manual.json` の `hex_note` | `destructive` は #ae4751に更新済。`card` は「#d5d3c0 sand / gray-40」のまま (C5-1の取り残し) | `card` の注記はC5-1レーンの範囲。値ではなく注記なので機械検証に落ちず残っていた。§4 Q3に含める |

## 4. まとめ確認事項 (Setaka判断)

| # | 事項 | 推奨 | 影響範囲 |
|---|---|---|---|
| Q1 | 残るAA未達J1 / L2 (destructive文字 × destructive/10の淡い面 = 3.946:1)。Figma値を守ると解けない | DSトークン整合タスク `3b670c9d-064c-8166` で「destructive文字の背後に淡い塗りを敷かない」方向に統一する (トークンを暗くしてFigmaを破るのではなく、表現側を変える) | チャットの評価ボタン / 各メニューの破壊的項目のフォーカス時 |
| Q2 | semantic `destructive` (#ae4751) と `brand.tea-red` (#b9525c) が別値になった | 現状維持。役割が違う (UIの警告色 / ジャーナルのカテゴリ色)。揃えたいならFigmaのブランドパレット側を実測してから | ジャーナルのカテゴリ色のみ |
| Q3 | Storybookの色見本 (`Colors.stories.tsx`) がshadcn既定値のまま・CSS変数名も実在しない。`design-kit.manual.json` の `card` 注記もC5-1前のまま | 別タスクでまとめて作り直す (トークン表示の自動生成に寄せる。手書きの色見本は必ず腐る) | Storybookのドキュメント面のみ (実画面に影響なし) |
| Q4 | Figmaの失敗バナーは罫線と文字が**同じ** `destructive`。成功バナーはFigmaが薄い `success` を文字に置いており、C6-1で文字だけ `success-foreground` に読み替えている (C6-1注8) | 失敗側はFigmaどおりでAA合格なので読み替え不要。成功側の扱いはC6-1のReview事項のまま (実測: 文字7.655:1 / 罫線1.468:1) | ログイン系のバナー |
| Q5 | 不透明度撤去で `/password` の誤入力エラー枠がはっきり見えるようになる (注1) | 現状維持 (開発用ゲートであり、枠が見えないほうが不具合) | `/password` のみ |

## 5. 記録の訂正 (他レーンの対比表)

本レーンでQA指摘の記述誤りを4件訂正した。訂正先は各ファイル内に注として残してある。

| 対象 | 旧記述 | 実測 / 訂正後 |
|---|---|---|
| `docs/fidelity/c6-1-fidelity.md` §5 + 注8 | 失敗バナーの実装は「`#ae4751` (Figmaどおり) / 4.52:1 AA合格」 | 実装は **#b9525c / 3.896:1でAA未達**だった。C6-1Rで #ae4751 / 4.52:1に是正 (注10を追加) |
| `docs/fidelity/c7-1-fidelity.md` §3 | 日時表記の実装実測は `2026年8月10日(月) 14:00–17:00` | 見本データに終了時刻が無く、実際は `2026年8月10日(月) 14:00` だった (同日レンジ分岐が一度も通っていない)。見本に終了時刻を入れて分岐を通し、実測値に訂正 |
| `docs/fidelity/c7-1-fidelity.md` §7 | 追従バーのCTA幅「43 / 358」= Figma一致 | 358は **SP390限定の値**。CTAは `w-full`・バーは `inset-x-0 px-4` なので幅 = viewport − 32で、SP375では **343** になる (注15を追加) |
| `docs/fidelity/c6-2-fidelity.md` §1 / §11 | 「設定・契約 →」はSPで `display:none` / `validate:design-map` は137 entries | 出し入れしているのは**リンク自身ではなく親ラッパ** `<div class="hidden lg:block">`。リンク自身は `display:inline` (注20)。design-mapは当時 **141** entries (133 → 141で8件追加。「8件追加」は正しく総数が誤記)、rebase時点の先端は156 (注21) |

## 6. 機械検証

rebase後 (`feat/c1-ds-foundation` = `50c48d7` の上) に全件再実行。

| コマンド | 結果 |
|---|---|
| `pnpm lint` | PASS (`--max-warnings 0` / 指摘0) |
| `pnpm typecheck` | PASS (`next typegen` + `tsc --noEmit` エラー0) |
| `pnpm test` | PASS **557/557** (99 files。うち本レーン新規 **10件** = `__tests__/format-event-schedule.test.ts`) |
| `pnpm build` | PASS (`Compiled successfully` → 全ルート生成) |
| `pnpm validate:tokens` | PASS **0 error** / 20 warning / 303 token (warningは既存のcamelCase命名のみ) |
| `pnpm validate:design-map` | PASS **156 entries** (本レーンでの追加は0件) |
| `pnpm validate:design-kit` | PASS (`design-kit is in sync with code` / components=62 / conflicts=8 / known_gaps=18) |

`pnpm build` は `.env.local` が無いと `/api/auth/login` のpage data収集で
`SESSION_SECRET environment variable is required` で落ちる。worktreeで計測するときは
本体ツリーの `.env.local` を持ち込む (gitignore済みなのでコミットには入らない)。

## 7. ブラウザ実測 (Vercel Preview)

Preview: `https://elxea-web-66x8i032v-setaka1103s-projects.vercel.app`
(見本データを描くため **このdeploy限定**で `PREVIEW_SEED=1` を渡している。
プロジェクトの環境変数は変更していない)

**実ログインはしていない。** バナーはクエリ `?error=<code>` を付けるだけで出る
(`app/[locale]/login/auth-error-banner.tsx` が `searchParams` を読む実装) ため、
パスワード入力もLINE認証も経由していない。

### 状態バナー (`[data-slot="auth-card-banner"]` の実測)

| 条件 | status | 文字色 | 面色 | 文字対比 | 罫線対比 | 寸法 / 体裁 |
|---|---|---|---|---|---|---|
| `/ja/login?error=LineAuthFailed` PC 1440x900 | 200 | **#ae4751** | **#ebe9e0** | **4.52:1 [OK]** | 4.52:1 [OK] | h44 / w354 / 14px / lh20 / 罫線1px / 角丸6px / `role="alert"` |
| 同SP 390x844 | 200 | #ae4751 | #ebe9e0 | **4.52:1 [OK]** | 4.52:1 [OK] | h44 / w300 / 14px / lh20 |
| `/ja/login?error=Unexpected` PC (別コード) | 200 | #ae4751 | #ebe9e0 | **4.52:1 [OK]** | 4.52:1 [OK] | h44 / w354 (文言だけ差し替わる) |
| `/ja/login?linked=true` PC (成功バナー・比較) | 200 | #464748 | #ebe9e0 | 7.655:1 [OK] | 1.468:1 (Figmaどおりの薄い `success`) | h44 / w354 |

h44 / 14px / lh20 / 罫線1px / 角丸6pxはC6-1 §5のFigma実測値と一致 (後退なし)。

### 日時の時間レンジ (スコープ2の確認)

| ページ | status | 実測描画 | 判定 |
|---|---|---|---|
| `/ja/events/seed-event-1` | 200 | **`2026年8月10日(月) 14:00–17:00`** | [OK] Figmaの見本と同じ時間レンジ表記 (同日レンジ分岐が通った) |
| `/ja/events` (一覧カード) | 200 | `2026年8月10日` / `2026年8月8日` / `2026年8月22日` | [OK] 終了日を併記しない (同じ日付の二重描画が起きていない) |

`h1` は `新茶テイスティング会 2026` で一覧 → 詳細の同一性も維持。

### コンソール / 実行時の健全性

| 項目 | 結果 |
|---|---|
| console `error` | **0件** |
| console `warning` | **0件** |
| `pageerror` | **0件** |
| ページstatus | 全6ページ200 |
| `requestfailed` | 97件。内訳はNext.jsのRSC prefetch中断 (`?_rsc=…` + `ERR_ABORTED`) とSentryのテレメトリ送信。C7-1 / C6-2レーンと同じ内訳で、ページの実行時エラーではない |
