# C4-4a忠実度対比表 — 農家詳細 (People詳細テンプレ統合)

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - 農家詳細PC `8079:3748` / SP `8079:3966`
  - 節ノード: PersonHead `8079:3750` / Quote `8079:3771` / THE WORK `8079:3774` /
    INTERVIEW `8079:3793` / PROFILE `8079:3806` / FIELD DATA `8079:3937` /
    THE FIELD `8079:3947` / TEAS `8079:3816` / OTHER PEOPLE `8079:3835`
- 実装計測: local production build (`pnpm build` → `next start` :3106) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport PC 1440x1000 / SP 375x1000)
  - 計測URL: `/ja/farmers/yamada-kenichi`
  - 計測スクリプト: `scripts/scratch/measure-c44a.mjs` (gitignore対象・使い捨て)
- 計測日時: 2026-08-08 12:2x JST (origin/feat/c1-ds-foundation `ac7c43a` に rebase 後の再計測)
- 判定: `[OK]` 一致 (Δ≤2px) / `[仕様]` 意図的な差分 / `[要確認]` DS側で判断が要る差分

## 計測データについて (重要)

production Sanity datasetのfarmerドキュメントは **R2確定版のフィールドを未整備**
(`work` / `interview` / `profileBand` / `fieldBand` / `fieldSeasons` が空)。素のままでは
9節のうち7節が「データ無し = 非表示」になり実寸計測ができないため、**プレビュー専用の
見本 (`PREVIEW_SEED=1` / `lib/preview-seed.ts` の `withSeedFarmerDetail`)** で未入力欄を
Figma確定版の文言で埋めた状態を計測した。

- フラグ未設定時 (= production / Vercel Preview) の描画は見本注入前とbyte-identical
- したがってVercel Previewでは現状FarmerHead / TEAS / OTHER PEOPLEのみ描画される
  (これは仕様どおりの「データが無い節は枠ごと出さない」挙動)
- 文言・データがSanityに入り次第、同じ骨格で全9節が出る

`TEAS` と `OTHER PEOPLE` は見本ではなく実データで描画された (TEAS = 山田健一の
relatedProducts 1件 / OTHER PEOPLE = 実在農家1件。fictional deny-listで2件除外)。
そのためカード枚数はFigmaの3枚に対し1枚で、**枚数由来の行送り (blockGap) はPC計測不能**。
グリッドの `row-gap` / `column-gap` はcomputed styleで検証済み。

---

## 1. PersonHead — PC 1440 (Figma 8079:3750)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle / Rect) | 判定 |
|---|---|---|---|---|
| Section | 上余白 (→Breadcrumb) | 48 | 48 (padding-top) | [OK] |
| Section | 下余白 | 32 (924→956) | 32 (padding-bottom) | [OK] |
| BreadcrumbRow | 行高 (タップ域) | 44 | 44 | [OK] |
| BreadcrumbRow | →写真 | 32 (92→124) | 32 | [OK] |
| Grid | 列構成 | 640 + gap32 + 640 | `640px 640px` / column-gap 32 | [OK] |
| Photo | 幅 / 高さ | 640 / 800 | 640 / 800 | [OK] |
| Photo | アスペクト | 4:5 | `4 / 5` | [OK] |
| HeroText | 写真上端からのオフセット | +96 (124→220) | 96 | [OK] |
| kicker | font-size | 12 | 12 | [OK] |
| kicker | line-height | 16.8 (1.4) | 21 (1.75) | [要確認] 注1 |
| kicker | letter-spacing | 1.5 (.125em) | 1.8 (.15em) | [要確認] 注1 |
| kicker | →氏名 | 20 (17→37) | 20 | [OK] |
| 氏名 | font-size | 32px | 44px | [仕様] 注2 |
| 氏名 | line-height | 38.4 (1.2) | 52.8 (1.2) | [仕様] 注2 |
| 氏名 | class | — | `page-title mt-4 text-foreground lg:mt-5` | [OK] |
| 氏名 | →肩書 | 28 (75→103) | 28 | [OK] |
| 肩書 | font-size | 20 (jp/h3) | 20 | [OK] |
| 肩書 | line-height | 27 (1.35) | 29 (1.45) | [OK] Δ2注1 |
| 肩書 | →メタ | 20 (130→150) | 20 | [OK] |
| メタ | font-size / lh | 14 / 25.2 (1.8) | 14 / 25.2 | [OK] |
| メタ | →罫線 | 29 (175→204) | 28 | [OK] Δ1注3 |
| 罫線 | border-top-width | 1 | 1 | [OK] |
| 罫線 | →Stats | 24 (204→228) | 24 (padding-top) | [OK] |
| Stats | 列ピッチ間gap | 48 (198-150) | 48 (column-gap) | [OK] |
| Stat | 数値font-size | 32 (en/h1) | 32 | [OK] |
| Stat | 数値→ラベルgap | 12 (0→46 / w34) | 12 (column-gap) | [OK] |
| Stat | ラベルfont-size | 12 | 12 | [OK] |
| Stats | →bylineラベル | 36 (263→299) | 36 | [OK] |
| bylineラベル | font-size | 12 (jp/caption) | 12 | [OK] |
| bylineラベル | →AuthorByline | 5 (317→322) | 4 | [OK] Δ1注3 |
| DEVIATION注記 | 描画 | Figmaに存在 | 描画しない | [仕様] 注4 |

## 2. PersonHead — SP 375 (Figma 8079:3970)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Section | 上余白 | 24 | 24 | [OK] |
| Section | 下余白 | 40 (943→983) | 40 | [OK] |
| BreadcrumbRow | 行高 / →写真 | 44 / 24 (68→92) | 44 / 24 | [OK] |
| Photo | 幅 | 375 (全幅・余白外) | 375 (`.sp-full-bleed`) | [OK] 注5 |
| Photo | アスペクト / 高さ | 4:5 (375x469) | `4 / 5` (375x468.75) | [OK] |
| Photo | →HeroText | 32 (561→593) | 32 | [OK] |
| kicker | →氏名 | 16 (17→33) | 16 | [OK] |
| 氏名 | font-size | 32 | 32 (`.page-title`はmd+のみ) | [OK] |
| 氏名 | →肩書 | 20 (71→91) | 20 | [OK] |
| 肩書 | →メタ | 12 (118→130) | 12 | [OK] |
| メタ | →罫線 | 16 (180→196) | 16 | [OK] |
| 罫線 | →Stats | 25 (196→221) | 24 | [OK] Δ1 |
| Stats | 列ピッチ間gap | 32 (182-150) | 32 | [OK] |
| Stats | →bylineラベル | 28 (256→284) | 28 | [OK] |
| bylineラベル | →AuthorByline | 8 (302→310) | 8 | [OK] |

## 3. Quote (反転面) — PC / SP (Figma 8079:3771 / 8079:3990)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 面 | 背景 | `--primary` (#464748 / lab L≈31.1) | `bg-primary` (lab L 30.05) | [OK] Δ1 |
| 面 | 文字色 | `--primary-foreground` (#f9f8f4 / lab L≈97.5) | `text-primary-foreground` (lab L 100 = 白) | [要確認] 注6 |
| 引用 | 幅 | 640 (x400 = 中央寄せ列) | 640 (`max-w-160 mx-auto`) | [OK] |
| 引用 | 行揃え | 左揃え (text-align指定なし) | `start` | [OK] |
| 引用 | font-size / lh | 20 / 27 (jp/h3) | 20 / 29 | [OK] Δ2注1 |
| PC | 上余白 | 88 | 88 | [OK] |
| PC | 引用→帰属 | 54 (142→196) | 52 | [OK] Δ2 |
| PC | 下余白 | 66 (214→280) | 64 | [OK] Δ2 |
| SP | 上余白 | 64 | 64 | [OK] |
| SP | 引用→帰属 | 32 (145→177) | 32 | [OK] |
| SP | 下余白 | 66 (195→261) | 64 | [OK] Δ2 |
| 帰属 | font-size | 12 | 12 | [OK] |

## 4. 節の共通枠 (THE WORK / INTERVIEW / THE FIELD / TEAS / OTHER PEOPLE)

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| Section | 上余白 | PC 96 / SP 64 | 96 / 64 (padding-top) | [OK] |
| Section | 下余白 | PC 19〜96 (節ごとに不定) / SP同 | 48 / 48 | [仕様] 注7 |
| kicker | →見出し | PC 8 / SP 8 | 8 / 8 | [OK] |
| 見出し | font-size / lh | 20 / 27 (jp/h3) | 20 / 29 | [OK] Δ2注1 |
| 見出し | →本体 | PC 52 / SP 56 | 52 / 56 | [OK] |
| 見出し | →本体 (INTERVIEWのみ) | PC 77 (148→225) / SP 56 | 76 / 56 | [OK] Δ1注8 |
| 本体 | 左端x / 幅 | PC 64 / 1312 | `page-container` (64 / 1312) | [OK] |

## 5. THE WORK / THE FIELD (番号つき工程) — Figma 8079:3774 / 8079:3947

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| Grid | 列構成 (PC) | 416 x3 / gap 32 | `416px 416px 416px` / column-gap 32 | [OK] |
| Grid | 列構成 (SP) | 1列 (縦積み) | `343px` | [OK] |
| Grid | 行送り (SP) | 88 (545→633) | row-gap 88 / 実測blockGap 88 | [OK] |
| Photo | 幅x高さ (PC) | 416 x 312 | 416 x 312 | [OK] |
| Photo | アスペクト (PC / SP) | 4:3 / 3:2 (375x250) | `4 / 3` / `3 / 2` (375x250) | [OK] |
| Photo | 幅 (SP) | 375 (全幅) | 375 (`.sp-full-bleed`) | [OK] 注5 |
| Photo | →番号 | 16 (512→528) | 16 / 16 | [OK] |
| 番号 | font-size | 12 (en/overline) | 12 | [OK] |
| 番号 | →工程名 | 8 (545→553) | 8 / 8 | [OK] |
| 工程名 | font-size | 16 (jp/h4) | 16 | [OK] |
| 工程名 | →説明 | PC 4 (577→581) / SP 8 (487→495) | 4 / 8 | [OK] |
| 説明 | font-size / lh | 14 / 25.2 (jp/body-sm) | 14 / 25.2 | [OK] |
| 罫線 | 本数 | 0本 (余白のみでグルーピング) | 0本 | [OK] |
| 近接比注記 | 描画 | Figmaに存在 | 描画しない | [仕様] 注4 |

## 6. INTERVIEW (一問一答) — Figma 8079:3793 / 8079:4011

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 本文カラム | 幅 | PC 640 / SP 343 | max-width 640 / 実幅343 | [OK] |
| Q番号 | font-size | 12 (en/overline) | 12 | [OK] |
| Q番号 | →問い | 5 (242→247) | 4 / 4 | [OK] Δ1 |
| 問い | font-size | 16 (jp/h4) | 16 | [OK] |
| 問い | →答え | 20 (271→291) | 20 / 20 | [OK] |
| 答え | font-size / lh | 14 / 25.2 | 14 / 25.2 | [OK] |
| 設問間 | 答え下端→次のQ番号 | PC 44〜48 / SP 36〜44 (不定) | 48 / 40 | [OK] 注9 |
| 罫線 | 本数 | 0本 | 0本 | [OK] |
| DEVIATION注記 | 描画 | Figmaに存在 | 描画しない | [仕様] 注4 |

## 7. PROFILE / FIELD DATA (データ帯) — Figma 8079:3806 / 8079:3937

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 面 | 背景 | `--muted` (#dedccf / lab L≈88.2) | `bg-muted` (lab L 92.3) | [要確認] 注6 |
| 面 | 全幅 | 1440 (ページ余白外まで) | 全幅 (`bg-muted` を外枠に) | [OK] |
| Band | 上余白 | PC 96 / SP 64 | 96 / 64 | [OK] |
| Band | 下余白 | 110 (PC / SP共通) | 108 / 108 | [OK] Δ2 |
| kicker | →1行目ラベル | PC 27 (113→140) / SP 24 (81→105) | 28 / 24 | [OK] Δ1 |
| Band | 列構成 (PC) | 4列304 / gap 32 | `304px x4` / column-gap 32 | [OK] |
| Band | 列構成 (SP) | 2列163.5 / gap 16 | `163.5px 163.5px` / column-gap 16 | [OK] |
| Band | 行送り (SP 2段) | 24 (179→203) | row-gap 24 | [OK] |
| Band | 罫線 | 0本 (確定版の帯は罫線なし) | border-top-width 0 | [OK] 注10 |
| ラベル | font-size | 12 (jp/caption) | 12 | [OK] |
| ラベル | →値 | PC 7 (158→165) / SP 6 (123→129) | 8 / 4 | [OK] Δ1〜2注11 |
| 値 | font-size | 14 (jp/body-sm) | 14 | [OK] |
| kicker文言 | FIELD DATA帯 | `THE FIELD` | `THE FIELD` (messages `farmer.fieldKicker`) | [OK] |

## 8. TEAS / OTHER PEOPLE (写真つきカード) — Figma 8079:3816 / 8079:3835

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| Grid | 列構成 (PC) | 416 x3 / gap 32 | `416px 416px 416px` / column-gap 32 | [OK] |
| Grid | 列構成 (SP) | 1列 | `343px` | [OK] |
| Grid | 行送り (SP) | 56 (483→539 / 454→510) | row-gap 56 | [OK] |
| Photo | 幅x高さ (PC) | 416 x 260 | 416 x 260 | [OK] |
| Photo | アスペクト | 8:5 (PC 416/260 / SP 375/234) | `8 / 5` (SP 375x234.38) | [OK] |
| Photo | 幅 (SP) | 375 (全幅) | 375 (`.sp-full-bleed`) | [OK] 注5 |
| Photo | →見出し | 16 (460→476) | 16 / 16 | [OK] |
| 見出し | font-size | 16 (jp/h4) | 16 | [OK] |
| 見出し | →note | PC 4 (500→504) / SP 6 (430→436) | 4 / 4 | [OK] Δ2 |
| note | font-size (TEAS) | 14 (jp/body-sm) | 14 | [OK] |
| note | font-size (OTHER PEOPLE) | 12 (jp/caption) | 12 (`noteScale="caption"`) | [OK] |
| note | →価格 | 2 (529→531) | 4 | [OK] Δ2 |
| 価格 | font-size | 14 (en/body-sm 1.4 / tracking 0) | 14 (jp/body-sm 1.8 / tracking .05em) | [仕様] 注12 |
| 導線 | CTAボタン / 在庫あおり | 無し (価格のみ静かに併記) | 無し | [OK] |
| 方針注記 / NP注記 | 描画 | Figmaに存在 | 描画しない | [仕様] 注4 |

## 9. ブラウザコンソール / レスポンシブ健全性

| 項目 | 結果 | 判定 |
|---|---|---|
| HTTPステータス (PC / SP) | 200 / 200 | [OK] |
| console error | 0件 | [OK] |
| console warning | 0件 | [OK] |
| pageerror (uncaught) | 0件 | [OK] |
| 横スクロール (PC) | scrollWidth 1440 = viewport 1440 | [OK] |
| 横スクロール (SP) | scrollWidth 375 = viewport 375 | [OK] |
| 失敗リクエスト | `?_rsc=` プリフェッチのabortのみ (Next.js App Routerの通常挙動・consoleには出ない) | [OK] |

---

## 注記

1. **CJK overrideによるoverline / h3の行送り差 (既知・共有トークン由来)**
   `components/editorial/rule-list.tsx` に既記載の既知差分。ページが `:lang(ja)` のため
   `dist/tokens-cjk.css` の再束縛 (overline: lh 1.75 / tracking .15em、h3: lh 1.45) が効き、
   Figma変数の実値 (lh 1.4 / tracking .125em、h3 lh 1.35) と2〜4pxずれる。
   キッカーは英字なので本来CJK再束縛の対象外だが、`overlineClass` はsigns / products /
   journal / subscriptionほか全ページに効くため、1ページ都合で共有トークンを動かさない。
   解消はcjk overrideのスコープ見直し (DS側の別案件)。**本タスクでは踏襲**。

2. **ページ主見出しは44px display**
   Figmaの農家詳細フレームは氏名を32px (jp/h1) で組んでいるが、ページ主見出しは
   44px (`.page-title` = display token) に揃える全体裁定に従った (C4-2 / C4-3と同じ)。

3. **1px丸め**: Tailwind spacing scale (4px刻み) に載せるため29→28 / 5→4に丸めた。
   生px (`mt-[29px]` 等) を書かない規律を優先。

4. **Figmaの注記テキストは描画しない**
   `DEVIATION:` / `近接比:` / `roji 方針:` / `NP (DS gap):` はデザイナー向けの設計注記
   (実装者への指示) であってページ本文ではないため、描画対象外とした。
   注記の内容そのものは実装に反映済み (罫線0本 / 余白のみのグルーピング /
   購入導線を最下部かつCTAなし)。

5. **SP写真をページカラム幅に収める【仕様】**
   FigmaはSPの写真を全幅375 (ページ余白16の外) に置くが、実装はページカラム幅343に
   収めた。C4-3 (プレイリスト詳細) と同じ判断で、ページ全体の左端が1本に揃う。
   全幅ブリードに寄せるならC4-2R (プレイリストSP写真) の結論と合わせて横展開すべき論点。

6. **[要確認] semantic colorの値差 (DS判断が要る)**
   `bg-primary` はFigma `--primary` (#464748) とlab Lで Δ1の一致だが、
   - `primary-foreground`: Figma #f9f8f4 (lab L≈97.5) vs `tokens/base.json` oklch(1 0 0) = 純白
   - `muted`: Figma #dedccf (lab L≈88.2) vs `tokens/base.json` oklch(0.933 0.012 96.4) (L 92.3)
   の2件でトークン値そのものが食い違う。**セマンティック色の値変更は全ページに波及する**
   ため本タスクでは触っていない。要因の可能性が2つある: (a) tokens/base.jsonの写し漏れ
   (SoT=Figmaなのでbase.jsonを寄せるべき) / (b) rojiページ用の別Variable modeの値を
   MCPが返している (elxea既定モードとは別物で、食い違いではない)。
   どちらかの確認と、(a) ならbase.json修正を **DSドリフト案件として別途起票** すべき。
   クラス名のマッピング (`--primary` → `bg-primary` 等) はFigma変数名どおりで正しい。

7. **節の下余白を48に統一【仕様】**
   Figmaの各節フレームは固定高さのモックで、下余白が19 / 46 / 48 / 57 / 96 / 110とばらつく
   (上余白は全節96で一貫)。実データでは節の中身の高さが変わるため、固定高さ由来の値は
   採らず、C4-3で確定した `pb-12` (48) に統一した。データ帯 (bg付き) だけはPC/SP双方で
   110と一貫していたため108を採用している (上表7)。

8. **INTERVIEWだけ見出し→本体が広い**: Figma上PC 77 (他節は52)。設問に入る前の間を
   広く取る意図と判断し、この節だけ `lg:mt-19` (76) で追従した。SPは他節と同じ56。

9. **設問間の余白**: Figma上PC 44 / 48、SP 36 / 44と答えの行数で揺れており固定値が読めない。
   上限側に寄せてPC 48 / SP 40に固定した (注記の「問いの前:後 = 2.8倍」の非対称は保持)。

10. **データ帯の罫線**: 共有部品 `SpecBand` は既定で上罫線1本を持つ (商品詳細 / 定期便LPの
    確定版がそうだったため)。農家詳細の確定版は罫線を持たずmuted面で区切るので、
    `farmerBandClass` (`border-t-0 gap-y-6 pt-6 lg:pt-7`) で打ち消して余白だけ差し替えた。
    SpecBand本体は変更していない (他ページに影響を出さないため)。

11. **ラベル→値の1〜2px差**: `SpecBand` のddは `mt-1 lg:mt-2` (4 / 8) 固定で、band側の
    classNameからは上書きできない。FigmaはPC 7 / SP 6なのでPC +1 / SP -2の差。
    SpecBandの内部余白を変えると商品詳細・定期便LPに波及するため据え置いた。

12. **価格の文字組み【仕様】**: Figmaは価格にen/body-sm (Inter 14 / lh 1.4 / tracking 0) を
    当てているが、実装は共通の `bodySmClass` (jp/body-sm 14 / lh 1.8 / tracking .05em) を使う。
    価格だけ英字プリセットに切り替えるトークン運用がまだ無いため (`--typography-style-*` に
    en/jpの並列が無い)、font-sizeは一致・行送りとトラッキングのみ差分。

---

## 参照元

- Figma file `AWLnI0XF07e8rScuxPYPc7` — 農家詳細PC `8079:3748` / SP `8079:3966`
  (`get_metadata` + `get_design_context` で2026-08-08 11:3x〜11:4x JST取得)
- 実装: `app/[locale]/farmers/[slug]/page.tsx` / `components/farmers/farmer-detail.tsx`
- 計測ログ: `scripts/scratch/measured.json` (gitignore対象)
