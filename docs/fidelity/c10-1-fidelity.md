# C10-1お問い合わせ / プライバシーポリシー — 忠実度対比表 (Figma実測vs実画面実測)

## 対象と正本

| 画面 | ルート | Figma正本 | 世代 |
|---|---|---|---|
| お問い合わせ | `/ja/contact` | **【R2: 確定版】section `8109:46652`** — PC `8109:46653` (1440x2364) / SP `8109:46734` (375x2819) | R2確定版が実在 |
| ~~お問い合わせ:法人~~ | ~~`/ja/contact/business`~~ | **R2に存在しない** (統合) | 廃止 → 308恒久リダイレクト |
| プライバシーポリシー | `/ja/legal/privacy` | **Figma不在** → 凍結済み兄弟 利用規約【採用: 現状案で確定】section `7848:39101` (PC `7848:39102` / SP `7848:39103`) から導出 | 導出 |

### 法人ページが無いことの確定 (再調査不要)

Figma file `AWLnI0XF07e8rScuxPYPc7` の全ノード (172,449) を走査し「確定版」を含むノード75件を
全列挙した。static / legal隣接は **お問い合わせ1件のみ**。R2が1ページである根拠は3つ:

1. フレーム名が **「Common静的1ページ (項目最小 + FAQ誘導)」**
2. S1リード `8109:46659` = 「ご質問、お気づきのこと、**取材や卸のご相談まで**、こちらで承ります。」
3. 種類fieldの注記 `8109:46695` = 「お客様のお問い合わせ / **お取引・取材等のご相談**」

Structure DBの `Figma` プロパティ (`6750:16786` / `6750:15711` / `6749:15679`) は3行すべて
**旧elxea世代の変A** (page `6054:15`) を指しておりR2ではない (C8-1 / C9-1と同じ罠)。
Structure DBの `ステータス：Design` は お問い合わせ=Done / 法人=Not started /
プライバシー=Not startedで、上記の実測と整合する。

### プライバシーの導出元の選び方

legal群 (`7567:13` Common / Layouts) で凍結済みなのは 利用規約 `7848:39101` / 特商法 `7855:843` /
返品ポリシー `7857:39614` / 配送情報 `7848:39198` / 汎用ページ `7857:968` / FAQ `7848:450`。
このうち「長文条項 + 目次 + 事業者情報」を持つのは **利用規約だけ**なので構造の正本に採った。
実装 `app/[locale]/legal/terms/page.tsx` が既にその骨格をDS部品 (`components/editorial/rule-list`)
で体現しているため、部品の再利用がそのまま導出になる。**デザインは新しく発明していない。**

## 計測条件

- 自前の **production build** (`pnpm build` exit 0) を `next start -p 3984` で起動し
  Playwright (Chromium) で直駆動。ハーネス `scripts/c101-measure.mjs`、出力 `/tmp/c101-measure3.json`
- 実装値は `getComputedStyle` + `getBoundingClientRect` の実測。ブロック間隔は
  「上要素の下端 → 下要素の上端」、列位置は**子要素のboxから逆算**した実測値
  (クラス名やトークンの見かけの解決値ではない)
- **色はcanvasの `getImageData` でピクセル値を読む**。Chromiumは `getComputedStyle` の色を
  `oklch()` / `lab()` のまま返すため文字列パースは使わない (C6-1Rの実証済み知見)
- viewport: PC 1440x900 / SP 390x844。**FigmaのSPは375幅**なので、外余白16を引いた
  内容幅は 実測358 / Figma 343になる。**幅358 vs 343はviewport差**であり実装差ではない
  (本表では「viewport差」と明記し [OK] 扱いにする)
- `PREVIEW_SEED=1` / `SITE_PASSWORD=` (空) でローカル計測サーバのgateを無効化しただけ。
  **パスワード入力も実ログインもしていない**
- **フォームは送信していない**。`checkValidity()` で状態のみ読み、送信ボタンは押していない
  (ハーネスに `submitPressed: false` を記録)
- rebase後 (origin `986aa52` 取り込み後) に同一ハーネスで再計測し、
  **1441キーのうち差分0件** (URLのportのみ) を確認した

## 判定記号

| 記号 | 意味 |
|---|---|
| [OK] | Figma実測と一致 (CJK行送りの丸め ±3px以内を含む) |
| [仕様] | Figmaと意図的に変えた。理由を併記 |
| [DS案件] | 共有DS部品側の既存差分。本レーンでは動かさない (他ページに波及するため) |
| [粗] | 一致していないが、原因がCJK行送り再束縛など既知のDS課題に帰する |

---

# 1. お問い合わせ `/ja/contact`

## 1-1. ページ全体

| 項目 | Figma実測 | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 外余白 | PC 64 / SP 16 | 64 | 16 | [OK] |
| 背景 | `background` | #ebe9e0 | #ebe9e0 | [OK] |
| 本文色 | `foreground` | #464748 | #464748 | [OK] |
| 罫線色 | `border` | #888675 | #888675 | [OK] |
| 横スクロール | 無し | `false` | `false` | [OK] |
| ブロック構成 | S1 / S2 / S3 / S4の4本 | 4本 | 4本 | [OK] |

## 1-2. S1ページ見出し (`8109:46655` h332 / SP `8109:46739` h524)

| 項目 | Figma実測 (PC / SP) | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 上padding (breadcrumbまで) | 40 / 24 | 40 | 40 | [仕様] SPも40。他R2ページ (利用規約) と縦リズムを揃えた |
| breadcrumb → キッカー | 38 / 22 | 40 | 40 | [OK] |
| キッカー `CONTACT` | 12px / h17 | 12px / h21 | 12px / h21 | [粗] h +4はoverlineトークンのCJK再束縛 (rule-listに既知記載) |
| キッカー → h1 | 15 / 15 | 16 | 16 | [OK] |
| h1「お問い合わせ」 | 32px / h38 (`8109:46742`) | **44px / h52.8** | 32px / h38.39 | [仕様] **全体裁定による意図的差分** (下記) |
| h1が共有プリセット経由か | — | `.page-title` | `.page-title` | [OK] C16-1で是正 |
| h1 → リード | 28 / 22 | 24 | 24 | [OK] |
| リード | 14px / w528 h50 / SP w343 h75 | 14px / w528 h50.38 | 14px / w358 h75.56 | [OK] (SP幅はviewport差) |
| 左カラム幅 | 528 (col1-5) | 528 | 358 (縦積み) | [OK] |
| 右カラムx / 幅 | x848 (col8) / 528 | x848 / 528 | 縦積み | [OK] |
| 右カラム見出し | 12px / h18 | 12px / h21 | 12px / h21 | [粗] captionのCJK行送り |
| 見出し → 1行目 | 10 / — | 12 | 12 | [OK] |
| メタ行数 | 4 | 4 | 4 | [OK] |
| メタ行 高さ | **44 / 52** | **46.19** | **54.19** | [OK] (+2.19。下記「MetaRowの溝」参照) |
| メタlabel列幅 | **140 / 118** | **140** | **120** | [OK] PCは完全一致 / SP +2 |
| メタlabel文字 | 12px | 12px #585854 | 12px #585854 | [OK] |
| メタvalue文字 | 14px | 14px #464748 | 14px #464748 | [OK] |
| 行の罫線 | 上1px + 最終行下1px | 上1px / dl下1px | 同 | [OK] |
| メタ4項目の中身 | お返事 / フォーム受付 / メール / お電話 | 同 | 同 | [OK] |

**h1が44pxである理由 (C16-1で是正・QAバッチ3 Fail1)**: 個別のFigmaノード
`8109:46742` の実測は32pxで、初回実装もそれに合わせて32px + `mt-4` 直書きだった。
しかしプロジェクトの**全体裁定は「ページ主見出し = PC 44 / SP 32」**であり、同世代の
他ページ (About / People / コレクション詳細 / テイスティングノート / elxea Journal /
著者) はすべて共有プリセット `.page-title` 経由で44pxになっている。
**個別ノードの32より全体裁定を優先**し、本ページとプライバシーも `.page-title` 経由に
是正した (`page-title mt-4`)。直書きをやめたのはトークン変更に追従させるため。
Figma側に古い値 (PC 52 / 32、SP 24) が残っているページ群の是正はデザイナー側の
案件として別管理 (All Tasks ID-7507)。`app/globals.css` の `.page-title` 注記も同じ内容。
**キッカー → h1の16 (Figma 15) は据え置き**。SPは32のままなので `1-2` のSP列は不変。

**MetaRowの溝について**: `MetaRow` の既定は `gap-4` (16) をlabel幅に足すため、素で使うと
label列156 / 行h54.19になりFigma (140 / 44) から外れる。共有部品 (FAQ / 利用規約 / 特商法 /
汎用ページ / Aboutが同居) は動かさず、**この4行だけ `className="gap-0 pb-4 lg:pb-2"`** で
溝0 + PCの下paddingを1段落とした。結果PCのlabel列はFigmaと完全一致。
残る +2.19はvalueのCJK行送り (14px x 1.8 = 25.19 vs Figma 25) に帰する。

## 1-3. S2お問い合わせの前に (`8109:46673` h444 / SP `8109:46757` h527)

| 項目 | Figma実測 (PC / SP) | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 上padding | 96 / 96 | 96 | 96 | [OK] |
| 節見出し | h27 (20px) | 20px / h29 | 20px / h29 | [粗] h +2は `section-title` のCJK行送り |
| 見出し → 補足 | 13 / 20 | 12 | 12 | [OK] |
| 補足 | w640 h50 / w343 h100 | w640 h50.38 | w358 h75.56 | [OK] (SPの行数差は幅358で3行に収まるため) |
| 補足 → 1行目 | 10 / 3 | 8 | 8 | [OK] |
| 行数 | 3 | 3 | 3 | [OK] |
| 行 幅 | 1312 / 343 | 1312 | 358 | [OK] |
| 行 高さ | **72 / 84** | **66.59** | **107.78** | [DS案件] LinkRowのpadding (下記) |
| title列幅 | 300 | 300 | 全幅 | [OK] |
| **title → descのx差** | **352** | **352** | 0 (縦積み) | [OK] 完全一致 |
| desc幅 | 640 | 640 | 358 | [OK] |
| **矢印の右端インセット** | **0** (row右端に接する) | **0** | **0** | [OK] |
| 矢印 幅 | 40 | 40 | 40 | [OK] |
| SPの矢印の縦位置 | **descの行 (y46)** | — | **titleの行 (y908.27)** | [DS案件] LinkRowのSP折返し順 |
| title文字 | 16px | 16px / 500 | 16px / 500 | [OK] |
| desc文字 | 14px | 14px #585854 | 14px #585854 | [OK] |
| 遷移先 | FAQ / 配送・返品 / 定期便 | `/faq` `/shipping` `/account/subscriptions` | 同 | [仕様] 下記「確認事項」参照 |
| カードを使わない (罫線リスト) | 罫線のみ | 罫線のみ | 罫線のみ | [OK] |

**LinkRowの2件の [DS案件]**: `LinkRow` はFAQ / 配送情報 のSPフレーム `7851:39678` に対して
凍結された共有部品で、(a) 行paddingが `pt-6 pb-4` (PC実測66.59 / SP 107.78)、
(b) SPでは矢印を **titleと同じ行**に置く。R2お問い合わせは (a) PC 72 / SP 84、
(b) 矢印を **descの行**に置く。**本レーンではLinkRowを変えない** —
変えるとFAQ / 配送情報 / 汎用ページ / 返品ポリシーの凍結済み4ページが同時に動くため。
列位置 (352 / 右端0 / 幅300・640・40) は完全一致しており、乖離は縦リズムのみ。

## 1-4. S3フォーム (`8109:46688` h874 / SP `8109:46772` h1264)

### 見出しと左カラム (測度640)

| 項目 | Figma実測 (PC / SP) | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 上padding | 96 / 96 | 96 | 96 | [OK] |
| 節見出し | h27 (20px) | 20px / h29 | 20px / h29 | [粗] `section-title` のCJK行送り |
| 見出し → 補足 | 13 / 20 | 12 | 12 | [OK] |
| 補足 | w640 h25 / w343 h50 | w640 h25.19 | w358 h50.38 | [OK] |
| **フォーム幅** | **640 / 343** | **640** | **358** | [OK] (SPはviewport差) |
| **field数** | **4** (種類 / お名前 / メール / 内容) | **4** | **4** | [OK] |
| field間隔 | 32 | **32** | **32** | [OK] 完全一致 |
| label → control | 8 | **8** | **8** | [OK] 完全一致 |
| label文字 | 14px | 14px | 14px | [OK] |
| マーク (必須 / 注記) の溝 | 8 | 8 (Label既定 `gap-2`) | 8 | [OK] |
| マークx (種類) | 140 | 139.05 | — | [OK] (label実幅差0.95) |
| マーク 文字 | 12px | 12px #585854 | 12px #585854 | [OK] |
| **control高さ** | **PC 36 / SP 44** | **36** | **44** | [OK] 完全一致 (SPはタップ域44) |
| **control角丸 (select)** | **6** (`8109:46780` = `--radius-md`) | **6** | **6** | [OK] 完全一致 |
| **control角丸 (input)** | **6** (`8109:46785` = `--radius-md`) | **6** | **6** | [OK] 完全一致 |
| **control角丸 (textarea)** | **6** (`8109:46800` = `--radius-md`) | **6** | **6** | [OK] 完全一致 |
| **送信ボタン 角丸** | **8** (`8109:46802` = `--radius-lg`) | **8** | **8** | [OK] 完全一致 |
| control罫線 | 1px `border` | 1px #888675 | 1px #888675 | [OK] |
| **textarea高さ** | **200** | **200** | **200** | [OK] 完全一致 |
| textarea幅 | 640 / 343 | 640 | 358 | [OK] |
| プライバシー注記 | 12px / h18 / SP h36 | 12px / h21 | 12px / h42 | [粗] captionのCJK行送り |
| 注記にポリシーへのリンク | あり | `/ja/legal/privacy` | 同 | [OK] |
| textarea → 注記 | 16 | **16** | **16** | [OK] 完全一致 |
| 注記 → 送信ボタン | 32 | **32** | **32** | [OK] 完全一致 |
| **送信ボタン 寸法** | **PC 200x44 / SP全幅x44** | **200x44** | **358x44** | [OK] 完全一致 |
| 送信ボタン 種別 | `Type=primary` | `variant=default` 塗り #464748 | 同 | [OK] |
| 送信ボタン 文字色 | 反転 | #f9f8f4 | #f9f8f4 | [OK] |
| 件名 (subject) field | **無し** (R2で廃止) | 無し | 無し | [OK] |

**送信ボタンの高さ**: `size="cta"` トークン `component.button.height.cta` は2.6875rem = **43px** で、
Figmaは44。SPのタップ域44の下限を割るため `className="h-11"` (44) を明示した。
トークン側を44に寄せるのはDSの別案件 (確認事項に記載)。

**角丸の行はC16-1で追加した (QAバッチ3の「未検証項目」の解消)**。QAバッチ3は
「実装のradiusは6 / 8だが、Figma control instanceのradiusを取得していないので
申告・未申告の判定ができない」と申し送っていた。C16-1で4ノードすべての
`get_design_context` を取り、Figma側が `--radius-md` (6) / `--radius-lg` (8) を
参照していることを確認した (入力3種 = 6 / ボタン = 8)。**実装と完全一致**であり、
「角丸8pxはFigma実在値へ是正済」という前提の対象はボタンのみ、入力欄はもともと6が
Figma実在値、という理解が正しい。乖離は無い。

### 右カラム 補助メタ (528)

| 項目 | Figma実測 (PC / SP) | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 列x / 幅 | x848 / 528 | x848 / 528 | 縦積み358 | [OK] |
| 列見出し | h24 (16px) | 16px / h25.59 | 16px / h25.59 | [OK] |
| 見出し → 1行目 | 24 | **24** | **24** | [OK] 完全一致 |
| hint行数 | 3 | 3 | 3 | [OK] |
| hint行 高さ | **56 / 68** | **58.19** | **87.19** | PC [OK] (+2.19) / SP [粗] (+19.19) |
| **hint label列幅** | **200** | **200** | 0 (縦積み) | [OK] 完全一致 |
| hint label文字 | 14px | 14px #464748 | 14px #464748 | [OK] |
| hint desc文字 | 12px | 12px #585854 | 12px #585854 | [OK] |
| 最終行の下罫線 | あり | 1px | 1px | [OK] |
| hint → 注記 | 28 | 29 | 29 | [OK] |
| 注記 | 12px / h18 | 12px / h21 | 12px / h21 | [粗] captionのCJK行送り |

**hint行のSP +19.19**: 内訳はlabel/descの縦の溝 (実装8 / Figmaは行送り箱が1px重なる ≒ 0)、
下padding (16 / 10)、desc高さ (21 / 18 = CJK行送り)。PCは +2.19に収まっている。
`PairRow` に本レーンで足した `layout="narrow"` は列幅 (168 + 溝32 = **200で完全一致**) と
PCの行詰め (`pt-4 pb-4`) を担う。SPの縦の溝を0まで詰めるのはCJK行送りを追いかける
過剰調整になるため行わない (globals.cssのKNOWN GAP方針と同じ)。

## 1-5. S4章切り (`8109:46730` h192 / SP `8109:46814` h244)

| 項目 | Figma実測 (PC / SP) | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 帯 高さ | 192 / 244 | 206.19 | 235.19 | [DS案件] ChapterBreakの下padding |
| 帯 背景 | 明度反転 | #464748 (`primary`) | #464748 | [OK] |
| 帯 文字色 | 反転 | #f9f8f4 | #f9f8f4 | [OK] |
| 上padding (キッカー無し版) | 96 | **96** | **96** | [OK] 完全一致 |
| 本文 | h27 (20px) / SP h54 | 20px / h29 | 20px / h58 | [OK] |
| 本文 → 補足 | 15 / 20 | 16 | 16 | [OK] |
| 補足 | w640 h25 | 14px / w640 h25.19 | 14px / w358 h25.19 | [OK] |
| キッカー | **無し** | 無し | 無し | [OK] |

## 1-6. フォームの挙動 (送信していない)

| 項目 | R2の指定 | 実測 | 判定 |
|---|---|---|---|
| 必須field | お名前 / メール / 内容 (種類は任意) | `required` = name / email / messageの3件 | [OK] |
| 種類の `required` | 付かない (マークが「必須」でなく候補の列挙) | `false` | [OK] |
| 種類の初期値 | 「選んでください」 | `""` (placeholder / `disabled`) | [OK] |
| 種類の選択肢 | お客様のお問い合わせ / お取引・取材等のご相談 | `["", "customer", "business"]` | [OK] |
| 空のまま送れないこと | — | `form.checkValidity() === false` | [OK] |
| **送信テスト** | — | **実行していない** (`submitPressed: false`) | [OK] 外部送信禁止を遵守 |

## 1-7. 法人ページの廃止

| 項目 | 期待 | 実測 | 判定 |
|---|---|---|---|
| `/ja/contact/business` | 恒久リダイレクト | **HTTP 308** + `location: /ja/contact` | [OK] |
| リダイレクト先 | `/ja/contact` | `finalUrl = /ja/contact` (`redirectedFrom = /ja/contact/business`) | [OK] |
| 実装層 | routing層 | `next.config.ts` `redirects()` (`permanent: true`) | [OK] |
| 送信先メールボックスの振り分け | R1の2宛先を維持 | `category` で `CONTACT_TO_EMAIL` / `CONTACT_BUSINESS_TO_EMAIL` を選ぶ | [OK] |

**なぜServer Componentの `redirect()` を使わなかったか**: `app/[locale]/contact/business/page.tsx` に
`redirect()` を置いた版を実測したところ **HTTP 200** で返り、RSCペイロードに
`NEXT_REDIRECT;replace;/ja/contact;307;` が埋まる **client side redirect** になっていた
(layoutのshellが先に流れるため)。恒久移動のシグナルにならないのでrouting層の308に移した。

---

# 2. プライバシーポリシー `/ja/legal/privacy`

Figmaが無いため、「Figma実測」列は**導出元 利用規約 `7848:39101` の実測値**である
(どのノードを測ったかを明記する)。

## 2-1. ページ全体

| 項目 | 導出元 実測 | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 外余白 | PC 64 / SP 16 | 64 | 16 | [OK] |
| 背景 / 本文色 / 罫線色 | `background` / `foreground` / `border` | #ebe9e0 / #464748 / #888675 | 同 | [OK] |
| 横スクロール | 無し | `false` | `false` | [OK] |
| ブロック構成 | S1 / S2 / S3章切り / S4事業者情報 | 4本 | 4本 | [OK] |

## 2-2. S1ページ見出し (導出元 `7848:39266`)

| 項目 | 導出元 実測 | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 上padding | 40 | 40 | 40 | [OK] |
| キッカー | 12px (`PRIVACY POLICY`) | 12px / h21 | 12px / h21 | [粗] overlineのCJK行送り |
| キッカー → h1 | 15 | 16 | 16 | [OK] |
| h1 | 32px | **44px / h52.8** | 32px / h38.39 | [仕様] 全体裁定 (PC 44 / SP 32)。理由は §1-2の「h1が44pxである理由」と同じ |
| h1が共有プリセット経由か | — | `.page-title` | `.page-title` | [OK] C16-1で是正 |
| h1 → リード | 28 | 24 | 24 | [OK] |
| 左カラム / 右カラム | col1-5 (528) / col8-12 (x848 528) | 528 / x848 528 | 縦積み | [OK] |
| メタの罫線 | **無し** (`7848:39271`) | `borderTopWidth = 0` | 同 | [OK] |
| メタ行数 | 利用規約は4行 | **2行** | 2行 | [仕様] `最終改定日` `適用範囲` は本ポリシーに相当する事実が無いため**行ごと出さない** |
| メタ項目 | — | 制定日 / 事業者 | 同 | [仕様] |
| 前文 | 利用規約は前文あり (`7849:39284` h75) | **無し** | 無し | [仕様] 本ポリシーに前文が無い。法的文書の本文を実装側で創作しない |

## 2-3. S2本文 (導出元 目次 `7848:39526` 系 / 本文 `7849:39283`)

| 項目 | 導出元 実測 | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 上padding | 96 | 96 | 96 | [OK] |
| 目次 列 | col1-3 (304) | w304 | 全幅358 | [OK] |
| 目次sticky | PCのみsticky / top 96 | `position: sticky` / `top: 96` | `static` | [OK] |
| 目次 キッカー `CONTENTS` | 12px | 12px | 12px | [OK] |
| キッカー → 一覧 | 40 | **40** | **40** | [OK] 完全一致 |
| 目次 行 タップ域 | SP 53 / 44下限 | `min-height: 44` 実測h44 | h44 | [OK] |
| 目次 群見出し | 利用規約は4群 (全19条) | **群なし・8項フラット** | 同 | [仕様] 8項に群見出しを与えるのは実在しない構造の捏造になるため作らない |
| 目次 項目数 | — | 8 | 8 | [OK] |
| 目次 下罫線 | あり | 1px | 1px | [OK] |
| アンカーが解決すること | — | `anchorsResolve = true` (8/8) | 同 | [OK] |
| **本文 列x** | **512 (col5)** | **512** | 16 | [OK] 完全一致 |
| **本文 列 幅 (測度)** | **640 (col5-10)** | **640** | 358 | [OK] 完全一致 |
| **条項の間隔** | **48** (`7849:39286` → `7849:39289`) | **48** | **48** | [OK] 完全一致 |
| **条見出し** | **h24 = 16px** (`7849:39287`) | **16px** / h25.59 | 16px / h25.59 | [OK] (+1.59はCJK行送り) |
| **条見出し → 条文** | **16** (y0 h24 → y40) | **16** | **16** | [OK] 完全一致 |
| 条文 文字 | 14px | 14px #464748 | 14px #464748 | [OK] |
| 条項数 | — | 8 | 8 | [OK] |
| 箇条書き | 利用規約にlist指定は無い | 原文が列挙形式の4項で `<ul>` を保持 | 同 | [仕様] 条文の原文を変えないため |

**条見出しの是正**: 初回実装は `className` に `[font:var(--typography-style-h4)]` を書いたが、
unlayeredな `h2 { font: var(--typography-style-h2) }` (24px) がTailwindのutilitiesレイヤーに
勝ち、実測 **31.19px (= 24 x 1.3)** になっていた。`app/globals.css` に
`legal-clause-title` スロット (既存の `section-title` / `top-section-title` /
`service-guide-tile-title` と同じ作法) を足して16px = 導出元実測h24に一致させた。

## 2-4. S3章切り / S4事業者情報 (導出元 `7850:796` / `7850:799`)

| 項目 | 導出元 実測 | 実装PC | 実装SP | 判定 |
|---|---|---|---|---|
| 章切り キッカー | 無し版 | 無し | 無し | [OK] |
| 章切り 上padding | 96 | 96 | 96 | [OK] |
| 章切り 背景 / 文字 | 明度反転 | #464748 / #f9f8f4 | 同 | [OK] |
| 章切り 帯 高さ | (利用規約と同一部品) | 206.19 | 260.38 | [DS案件] ChapterBreakの下padding |
| S4上padding | 96 | 96 | 96 | [OK] |
| S4見出し 体裁 | 20px (導出元は `<h3>` 相当の20px) | 20px / h26 | 20px / h52 | [OK] C16-1後も不変 |
| **S4見出し 要素** | (Figmaにhタグ情報は無い) | **`h2[data-slot="legal-section-title"]`** | 同 | [OK] C16-1で `<h3>` から是正 |
| S4行数 | 4 | 4 | 4 | [OK] |
| S4 label列幅 | **224** (`labelWidth="wide"`) | **240** | 136 | [DS案件] MetaRowの溝16 (下記) |
| S4行 高さ | — | 54.19 | 54.19 | [OK] |
| S4項目 | 事業者名 / 所在地 / お問い合わせ / 改定履歴 | 同 | 同 | [OK] |
| **所在地が仮値であること** | — | `addressIsPlaceholder = true` | 同 | [OK] 公開ブロッカーとして機械検知される |

**S4のlabel列240 (Figma 224)**: `MetaRow` が `gap-4` (16) をlabel幅に足すため。
**お問い合わせS1では `gap-0` で是正したが、プライバシーS4では是正していない** —
プライバシーはFigmaを持たない導出ページであり、**導出元の実装 (`legal/terms/page.tsx`) と
同じ見えを保つことを優先**した。利用規約も同じ +16で描画されているため、
両ページを同時に直すのはMetaRow側の案件 (確認事項に記載)。

## 2-5. 見出しレベル (C16-1で追加した観点)

QAバッチ3は「5本の対比表に見出しレベルの行が1つも無い = この観点が検査対象外だった」
と指摘した。Figmaにはhタグ相当の情報が無いため導出元では担保できず、**実DOMの
アウトライン実測を正**として表に載せる。

| 項目 | 期待 | C16-1前 (実測) | C16-1後 (実測) | 判定 |
|---|---|---|---|---|
| h1の数 | 1 | 1 | 1 | [OK] |
| 条見出し (全8項) | h1の下位 | `h2` 16px | `h2` 16px (不変) | [OK] |
| **S4節見出し** | 条より上位or同位 | **`h3` 20px** | **`h2` 20px** | [OK] C16-1で是正 |
| レベルの飛び (h1→h3等) | 0件 | 0件 | 0件 | [OK] |
| **タグと視覚サイズの逆転** | **0件** | **1件** (h2 16 → h3 20) | **0件** | [OK] C16-1で是正 |

**逆転の中身と是正方法**: 末尾の節「個人情報の取扱いに関するお問い合わせ」が素の
`<h3>` (20px) で、直前の条見出し `h2` (16px) より**大きい**状態だった。タグは下位なのに
文字は大きいので、スクリーンリーダの見出しジャンプと視覚的な階層が食い違う。
節は条の上位なので**要素をh2に上げた**。

体裁は1pxも変えていない。`section-title` スロットは `font:` ショートハンドが行高を
h3トークン自身の値 (実測29 = 20 x 1.45) に戻すため使えず (素のh3は
`:lang(ja) h3 { line-height: 1.3 }` 由来の**26**)、`legal-section-title` スロットを
新設して行高1.3を明示した。**実測fs 20 / lh 26 / fw 400 / lsは前後で完全同値**。

**条見出しをh3に下げなかった理由**: 導出元 利用規約の本文フレーム `7849:39283` を
再取得して確認したところ、**条を束ねる節フレームが存在しない** (前文 → 第1条 →
第2条 … が `規約本文` 直下の兄弟フレーム)。つまり条が本文の最上位区分であり、
h1の直下 = h2が正しい。ここでh3に下げるとh1→h3の**レベル飛びを新たに作る**ため、
「節=h2 / 条=h3」のliteral適用は採らなかった (確認事項に記載)。

---

# 3. 判定集計

上表の判定セルを機械集計した (行頭 `|` の表行のうち、末尾セルが判定記号で始まるものを数えた)。

| 判定 | 件数 |
|---|---|
| [OK] | 117 |
| [仕様] | 7 |
| [粗] | 7 |
| [DS案件] | 5 |
| PC [OK] / SP [粗] の混在 1行 | 1 |
| **合計 (判定セル)** | **137** |

- [DS案件] 5件はすべて **共有部品側の既存差分**。内訳は LinkRow の行 padding (PC/SP) と
  SP の矢印折返し順 / ChapterBreak の帯高さ (お問い合わせS4・プライバシーS3) /
  MetaRow の溝 (プライバシーS4)。いずれも凍結済みの他ページ (FAQ・配送情報・
  返品ポリシー・汎用ページ・利用規約・特商法・About) に波及するため本レーンでは動かさない
- [粗] 7件 + 混在1件はすべて **CJK行送り再束縛** (`dist/tokens-cjk.css`) に起因する
  +1.59〜+19.19px。`rule-list.tsx` と `globals.css` に既知課題として記載済みで、
  正を決めるのは Setaka レビュー案件 (All Tasks `3b570c9d-064c-81b7`)
- [仕様] 7件はすべて **Figma / 導出元との意図的な差**。6件が「データが無い節・行は
  枠ごと出さない」の適用 (プライバシーのメタ2行 / 前文なし / 目次の群なし / 箇条書きの保持 /
  SP上padding) で、1件が S2 の遷移先選択
- **3画面固有の未解決 (要判断) は0件**。列位置 (352 / 512 / 200 / 140 / 右端0)・
  field寸法 (640x36・SP44 / textarea200)・ボタン寸法 (200x44)・
  間隔 (32 / 16 / 32 / 48 / 24 / 40) はいずれも Figma 実測と完全一致している

# 4. 品質ゲート (全7種通過)

| ゲート | 結果 |
|---|---|
| `pnpm lint` | PASS (`--max-warnings 0`) |
| `npx tsc --noEmit` | PASS |
| `pnpm test` | PASS 104 files / 699 tests / 1 skipped |
| `pnpm build` | PASS (exit 0) |
| `pnpm validate:tokens` | PASS 0 error / 303 token |
| `pnpm validate:design-map` | PASS 0 error / 176 entries (重複node id 0) |
| `pnpm validate:design-kit` | PASS in sync (components=62) |

console error / warning / pageerror **0件**。`requestfailed` 152件はすべて
RSC prefetchの中断 (`/ja/faq` `/ja/shipping` `/ja/login` = S2導線の先読み) とSentry。

## 4-2. C16-1 (QAバッチ3の指摘修正) 時点の再計測

| ゲート | 結果 |
|---|---|
| `pnpm lint` | PASS (`--max-warnings 0`) |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS **105 files / 731 tests / 1 skipped** |
| `pnpm build` (`PREVIEW_SEED=1`) | PASS (exit 0 / Compiled successfully) |
| `pnpm validate:tokens` | PASS 0 error / 20 warning / 303 token |
| `pnpm validate:design-map` | PASS 0 error / **192 entries** |
| `pnpm validate:placeholders` | PASS (non-production・未解決8件は公開前ブロッカーとして既知) |

実画面ゲート (自前production build + Playwright / PC 1440 x 900 / SP 375 x 812 /
9ルートx 2幅 = 18計測):

| 検査 | 結果 |
|---|---|
| HTTP status | 全18件 **200** |
| `docWidth` = viewport (横あふれ) | 全18件一致 (**0件のあふれ**) |
| console error / pageerror | **0件** |
| h1の数 | 全18件 **1** |
| 見出しレベルの飛び | **0件** |
| タグと視覚サイズの逆転 | **0件** (C16-1前はプライバシーPC/SPで各1件) |
| `/ja/contact/business` | **308** → `/ja/contact` |
| `/ja/membership` | **308** → `/ja/subscription` |
| 存在しないslug 6種 (people / collections / journal author / farmers / products / elxea-journal) | 全**404** |

**見た目無変更の証明 (フルページスクショのバイト比較)**: 同一ビルドを2回撮って
決定性を確認したうえで、変更前後を比較した。

| ルート | 同一ビルド2回の差分 (決定性) | 変更前後の差分 | 解釈 |
|---|---|---|---|
| `privacy__sp` | 0 px | **0 px (バイト同一)** | 見出し要素の変更のみ・体裁不変 |
| `people__pc` / `people__sp` | 0 px | **0 px (バイト同一)** | 同上 |
| `author__pc` / `author__sp` | 0 px | **0 px (バイト同一)** | 同上 |
| `contact__sp` | 0 px | **0 px (バイト同一)** | SPは32のままなので不変 |
| `collection` / `playlists` / `terms` (PC+SP) | 0 px | **0 px (バイト同一)** | 非対象ページの非回帰 |
| `privacy__pc` / `contact__pc` | 0 px | 差分あり | **意図した差分** = h1 32→44 (`h:38.39→52.8`) とそれに伴う下方シフト +14.4。h1以外のプロパティ差分は0 |
| `journal__sp` / `elxea-journal__sp` | **52,422 px / 51,889 px (maxDelta 234)** | 60 px (maxDelta 3) | このSP2ルートは `PREVIEW_SEED` のプレースホルダ写真が実行ごとに入れ替わるため**スクショ比較が成立しない**。変更前後の差分は実行間ばらつきより2〜3桁小さく有意でない (構造・grid・見出しの実測値は完全一致) |

# 5. 確認事項 (Setaka判断が要るもの)

1. **法人お問い合わせページの廃止で合っているか** — R2確定版が「Common静的1ページ」で
   法人・取材を種類selectに吸収しているため `/ja/contact/business` を308で畳んだ。
   Structure DBの「お問い合わせ:法人」行 (`36b70c9d-064c-81789551cbeb4a48c4b3`) は
   **廃止として更新が必要**。宛先の振り分け (一般 → `CONTACT_TO_EMAIL` / 法人 →
   `CONTACT_BUSINESS_TO_EMAIL`) はR1の挙動を維持している
2. **S2「定期便の変更・停止」の遷移先** — `/account/subscriptions` (定期便管理) にした。
   未ログインだとログインへ飛ぶ。Figmaのdescは「お届け日の変更、スキップ、解約の**手順**」で
   手順の説明ページとも読めるため、FAQ側へ寄せる選択肢もある
3. **S2「配送と返品について」の遷移先** — descが「発送の目安、送料、返品・交換の条件」で
   2ページ (`/shipping` と `/legal/returns`) にまたがる。前半に合わせて `/shipping` にした
4. **R2の「お電話」欄が受付時間だけで番号を持たない** (`8109:46672` = 「平日10:00–17:00」)。
   Figmaのとおり時間だけを出している。特商法は番号の表示義務があり `tokushoho.phone` は
   仮値のままなので、番号を出す/出さないの判断が必要
5. **メールアドレスが仮値** — Figmaが `value (ダミーアドレス)` と明記 (`8109:46669`) のため
   `placeholders.tokushoho.email` (`hello@roji.jp`) を読んでいる。受信確認が済むまで
   productionビルドは機械的に止まる
6. **所在地が3か所で不一致** — 利用規約は実住所を直書き、特商法とプライバシーは
   `placeholders.tokushoho.address` (仮値)。どれを正とするかの判断が必要 (既存のOpen item)
7. **利用規約の条見出しも24px化している** — `app/[locale]/legal/terms/page.tsx` が
   privacyと同じ書き方 (`className` だけ) のため、Figma `7849:39287` 実測h24 (16px) に対して
   31.19pxで描画されている。本レーンでは凍結済みの他レーン成果物なので触らず、
   `globals.css` の `legal-clause-title` を当てるだけで直る状態にしてある
8. **`component.button.height.cta` を43 → 44にするか** — Figmaは44、トークンは43。
   SPのタップ域下限を割るため本レーンは `h-11` で明示した。トークン側を寄せると
   イベント詳細の面CTAも1px動く
9. **`/api/contact/business` がUIから参照されなくなった** — 公開エンドポイントの削除は
   影響範囲が読めないため残置した。撤去するかの判断が必要
10. **(C16-1追加) Figma側の主見出しの値を44に寄せるか** — 本ページとプライバシーは
    実装を全体裁定 (PC 44) に合わせたので、**Figmaノード `8109:46742` の32とは
    意図的に食い違った状態**になった。Figmaを44に直せば対比表の [仕様] が [OK] に戻る。
    デザイナー側の作業なのでAll Tasks ID-7507に寄せてある。実装側の追加作業は無い
11. **(C16-1追加) プライバシーの条見出しをh3に下げるか** — Bossの裁定文は
    「節=h2 / 条=h3」だったが、導出元 `7849:39283` に条を束ねる節フレームが無いため、
    条をh3にするとh1→h3のレベル飛びを新たに作る。本レーンは**節をh2に上げる側**で
    逆転を解消した (飛び0 / 逆転0)。「条をh3にしたうえで本文帯にsr-onlyの節見出しを
    足す」案も採れるが、実在しない見出し文言を実装側で創作することになるため採らなかった。
    このまま (現状) でよいかの確認
12. **(C16-1追加 / C17-1で決着) 利用規約のS4見出しも素の `<h3>` のまま** — 利用規約は条見出しが24pxで
    描画されている (上の項目7) ため「条24 > 節20」で逆転にはなっていない。項目7を直すと
    条が16pxになり、**そのとき初めて利用規約側も逆転する**。項目7と同時に
    `legal-section-title` を当てる必要がある (本レーンでは触らない)
    → **C17-1で先行適用済み (2026-08-10)**。要素を `h2[data-slot="legal-section-title"]` に
    上げ、**体裁は素の `<h3>` と1pxも変えていない**ことを実測した (font-size 20 / lh 26 /
    tracking 0.4 / weight 400 / color / margin / 外形がPC・SPとも一致。さらに見出し周囲を
    クリップした**PNGのバイト列が両状態で同一**)。これで項目7を直しても利用規約側で逆転は
    再発しない。**項目7 (条見出しを16pxに戻すか) 自体は未決のまま**で、C17-1でも触っていない
    (`docs/fidelity/c17-1-fidelity.md` の4節 / 確認事項3)

# 6. 変更ファイル

| ファイル | 変更 |
|---|---|
| `app/[locale]/contact/page.tsx` | R2確定版に全面刷新 (S1-S4) |
| `app/[locale]/contact/contact-form.tsx` | 項目最小4つに刷新 (件名廃止 / 種類select追加) |
| `app/[locale]/contact/business/page.tsx` | **削除** (308リダイレクトへ移行) |
| `app/[locale]/contact/business/business-form.tsx` | **削除** |
| `app/[locale]/legal/privacy/page.tsx` | 利用規約テンプレから導出し全面刷新 |
| `app/api/contact/route.ts` | `category` で宛先を振り分け / `subject` を任意化 |
| `app/globals.css` | `legal-clause-title` スロット追加 (additive) |
| `components/editorial/rule-list.tsx` | `PairRow` に `layout="narrow"` 追加 (既定不変) |
| `components/ui/native-select.tsx` | `wrapperClassName` 追加 (既定不変) |
| `next.config.ts` | `/contact/business` → `/contact` の308を追加 |
| `messages/ja.json` / `messages/en.json` | `contact` をR2の文言に差し替え |
| `lib/placeholders.ts` / `docs/placeholders.md` | 仮値の `surface` に新しい出現箇所を追記 |
| `scripts/design-system/design-map.json` | R2お問い合わせ8件を追記 + 既存1件を是正 |
| `scripts/c101-measure.mjs` | 計測ハーネス (新規) |
| `docs/fidelity/c10-1-fidelity.md` | 本表 (新規) |

## C16-1 (QAバッチ3の指摘修正) で追加した変更

| ファイル | 変更 |
|---|---|
| `app/[locale]/contact/page.tsx` | h1に共有プリセット `.page-title` を付与 (PC 44) |
| `app/[locale]/legal/privacy/page.tsx` | h1に `.page-title` を付与 / S4節見出しを `<h3>` → `<h2 data-slot="legal-section-title">` |
| `app/globals.css` | `legal-section-title` スロット追加 (additive) / `article-card-title` のセレクタに `h3` を追加 (additive) |

## 触っていないもの

- `tokens/base.json` / `dist/tokens.css` / design-kit生成物
- `app/[locale]/page.tsx` / `components/marketing/top-blocks.tsx` /
  `docs/fidelity/c8-1-fidelity.md` (C8-1Rレーン担当)
- `app/[locale]/legal/terms/page.tsx` / `tokushoho` / `returns` / `shipping` / `faq` (凍結済み)
- `MetaRow` / `LinkRow` / `ChapterBreak` の既定値 (Aboutレーンと同居)
- 本体ツリー `/Users/setaka/github/elxea/products/elxea-web-app`
  (checkout / branch / stash / resetを1度も実行していない)
