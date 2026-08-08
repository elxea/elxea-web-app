# C6-2忠実度対比表 — マイページ (/ja/account)

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - section【R2: 確定版】`マイページ (トップ)` `8095:731`
  - PC 1440 `8095:733` / TitleRow `8095:735` / AccountIdentityLine `8095:738` /
    GreetingBand `8095:740` / SectionHeader `8095:753` / UpcomingGrid `8095:756` /
    RecordCard `8095:757`,`8095:761`,`8095:765` / SectionHeader `8095:773` /
    ContinueGrid `8095:776` / ExpCard `8095:777`,`8095:782` /
    SectionHeader3 `8096:117` / PastExpGrid `8096:120` /
    SectionHeader4 `8144:1248` / PaymentMethodGrid `8144:1251` /
    PaymentMethodCard `8144:1252` / AccountOpsBand `8095:787`
  - SP 375 `8095:792` / TitleBlock `8095:796` / GreetingBand `8095:799` /
    SectionHeader `8095:812` / UpcomingList `8095:815` / RecordCard `8095:816` /
    SectionHeader2 `8095:836` / ContinueList `8095:839` / ExpCard `8095:840` /
    SectionHeader3 `8096:133` / PastExpList `8096:136` /
    SectionHeader4 `8145:1248` / PaymentMethodList `8145:1251` /
    PaymentMethodCard `8145:1252` / AccountOpsBand `8095:850`
  - 旧elxea版 `6697:8695` は使わない (R2確定版が正本)
- 実装計測: local production build (`pnpm build` → `next start`) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測
  - 計測URL: `/ja/account` (viewport **PC 1440x1000 / SP 375x1000**。SPはFigma
    フレーム幅375に合わせた。他レーンの390ではなく375なのは、このフレームの
    外余白16と内容343をそのまま比較するため)
  - 起動: `SITE_PASSWORD= PREVIEW_SEED=1 next start -p 3162`
    → `scripts/scratch/measure-c62.mjs` (gitignore対象・使い捨て)
  - 計測日時: 2026-08-08 23:2x–23:4x JST (`origin/feat/c1-ds-foundation` @ `95ca313` 起点)
- 判定: `[OK]` 一致 (Δ≤2px) / `[仕様]` 意図的な差分 (出典あり) /
  `[DS案件]` DS一括棚卸しタスク (3b670c9d-064c-8166) で扱う既知差分

## 計測データについて (重要)

`/ja/account` はログイン必須で、素のままではログイン誘導しか描かれない。確定版の4節
(これから / 続き / これまで / お支払い方法) をカードが載った状態で実寸計測するため、
**プレビュー専用の見本 (`PREVIEW_SEED=1` / `lib/preview-seed.ts` の `seedAccountView()`)**
でFigma確定版フレームの見本値 (結城さん / yuki@example.com / 8月20日の定期便 /
9月2日・9月14日のイベント / お気に入り2件 / 注文3件 / VISA •••• 1234) を流した状態を
計測した。

- フラグ未設定時 (= production / Vercel Previewの既定) は `seedAccountView()` が
  `null` を返し、描画は見本導入前と同じ (ログイン誘導のまま)
- Shopify / Firestoreへは読み書きしない (純粋なオブジェクトリテラル)。実在の顧客
  データは1件も含まない (メールは予約ドメインexample.com)
- **実ログインはしていない。パスワード入力も有効トークンの生成もしていない。**
  `middleware.ts` の `/account` ガードはcookieの**存在**だけを見る (L99-106) ので、
  計測ブラウザにダミーの `line_session` を置いてページまで到達させ、ページ側は
  実セッション不成立 → 見本描画に落ちる経路を使った
- したがって **Vercel Previewで見えるのはログイン誘導**。カードが載った状態は上記
  フラグ付きローカルproductionビルドでの計測が正

---

## 0. 横幅・外余白の扱い (全節に効く前提)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| 全帯 | PC外余白 | 64 | 64 (`--layout-grid-margin-desktop`) | [OK] 完全一致 |
| 全帯 | PC内容カラム幅 | 1312 | 1312 | [OK] 完全一致 |
| 全帯 | SP外余白 | 16 | 16 (`--layout-grid-margin-mobile`) | [OK] 完全一致 |
| 全帯 | SP内容カラム幅 | 343 | 343 | [OK] 完全一致 |
| 面つき帯 | 背景の広がり | 画面全幅 (1440 / 375) | 全幅 (`bg-card` の外枠) + 中身は `.page-container` | [OK] |
| ページ | 横スクロール | なし | `documentElement.scrollWidth` = 1440 / 375 | [OK] |

このフレームはFigmaの外余白がトークン値と**一致する** (カートC5-1の80/20のような
食い違いが無い)ので、`conflicts[c-04]` の注記は本ページには不要。

---

## 1. TitleBlock — 主見出し + ログイン中の表示

PCはTitleRow (`8095:735`) + AccountIdentityLine (`8095:738`) の2帯、
SPはTitleBlock (`8095:796`) 1帯。実装は1ブロックにして内部gapで作る。

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 上余白 | 40 / 24 | 40 / 24 | [OK] |
| 枠 | 下余白 | 24 / 16 | 24 / 16 | [OK] |
| 枠 | 見出し→識別行gap | 8 / 6 | 8 / 6 | [OK] |
| 枠 | ブロック高 | 128 / 102 | 145.8 / 105.39 | [仕様] 注1・注2 |
| 「マイページ」 | font-size | 32 / 32 | **44** / 32 | [仕様] 注1 |
| 「マイページ」 | line-height | 38.4 (1.2) / 38.4 | 52.8 (1.2) / 38.39 | [仕様] 注1 |
| 「マイページ」 | font-weight | 300 / 300 | 300 / 300 | [OK] |
| 「マイページ」 | letter-spacing | 0.64 (2%) / 0.64 | 0.88 (2%) / 0.64 | [OK] 比率一致 注1 |
| 「マイページ」 | 色 | `foreground` #464748 (lab 30.10) | lab 39.88 = #5d5e61 | [DS案件] 注3 |
| 識別行 | font-size / weight | 12 / 400 | 12 / 400 | [OK] |
| 識別行 | line-height | 18 (1.5) | 21 (cjk 1.75) | [DS案件] 注2 |
| 識別行 | letter-spacing | 0.6 (5%) | 0.6 | [OK] 完全一致 |
| 識別行 | 色 | `muted-foreground` #585854 (lab 37.29) | lab 37.41 | [OK] Δ0.12 |
| 「設定・契約 →」 | PC表示 / 位置 | 表示・右端baseline揃え | `display:block` / 右端baseline | [OK] |
| 「設定・契約 →」 | SP表示 | **無し** (SP TitleBlockはリンクを持たない) | `display:none` | [OK] 完全一致 |

注1: 主見出しは**全体裁定** (R2の全ページ主見出しをdisplayトークン44pxに揃える)
に従い `.page-title` を使う。Figmaのこのフレームは32 (jp/h1) だが、products /
tea-menu / collections / journal / カート等の兄弟ページが44なので、1ページだけ32に
落とすと画面間で主見出しの階層が崩れる。letter-spacingは2% 比率が一致している
(44 × 2% = 0.88)。ブロック高の差17.8のうち14.4はこの44px化ぶん。

注2: 12px系 (識別行 / カードの日付 / 節見出しの右リンク / 補足) はFigmaの
`jp/caption` がlh 1.5 (=18) なのに対し、実装は `typography.style.caption` のcjk再束縛
(lh 1.75 = 21) が効く。**DS全域の文字組みトークンの問題**なので本レーンでは動かさない
(C5-1注7と同一の扱い)。1行あたり Δ3。TitleBlockの残差3.4と各カードの高さ差は
すべてこの積み上がり。

注3: `foreground` トークンがFigmaと食い違う既知差分 (C5-1注16と同一。Figma #464748 =
lab L 30.10 vsコード #5d5e61 = lab L 39.88)。兄弟ページと本文色を揃える方を採り
`text-foreground` のままにした。

## 2. GreetingBand (PC `8095:740` / SP `8095:799`)

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 面の色 | `card` #f4f3ed (lab 95.77) | lab 95.76 (`bg-card`) | [OK] 完全一致 |
| 枠 | 上下padding | 48 / 32 | 48 / 32 | [OK] |
| 枠 | 内gap | 8 / 6 | 8 / 6 | [OK] |
| 枠 | ブロック高 | 167 / 182 | 167.58 / 167.78 | [OK] PC Δ0.6 / SPは注4 |
| 挨拶 | font-size / weight | 32 / 300 | 32 / 300 | [OK] |
| 挨拶 | line-height | 38.4 (1.2) | 38.4 | [OK] 完全一致 注5 |
| 挨拶 | letter-spacing | 0.64 (2%) | 0.64 | [OK] 完全一致 |
| 挨拶 | 行数 (SP) | 2行 (76.8) | 2行 (76.78) | [OK] |
| リード | font-size | 14 / 12 | 14 / 12 | [OK] 完全一致 |
| リード | line-height | 25.2 (1.8) / 18 (1.5) | 25.2 / 21 | [OK] PC完全一致 / SPは注2 |
| リード | letter-spacing | 0.7 (5%) / 0.6 | 0.56 / 0.6 | [OK] Δ0.14 |
| リード | 色 | `muted-foreground` | lab 37.41 | [OK] |

注4: SPのブロック高差 -15は**文言を短くしたぶん**。Figmaのリードは
「秋の火入れがすすむころ。次のお便りと、お席の予定をまとめました。」でSPでは2行 (36)
になるが、実装は先頭の季節句を落として「次のお便りと、お席の予定をまとめました。」の
1行 (21) にした。理由: 季節句は固定文字列なので**1年のうち9か月は事実と合わなくなる**
(季節に追従する仕組みは本レーンの範囲外)。→「まとめ確認事項」Q1

注5: **本レーンで直した唯一の描画バグ**。最初の実装は
`[font:var(--typography-style-h1)]` + `leading-[1.2]` のutility併用だったが、utilities
では両者の適用順を制御できず実測line-heightがh1トークンのcjk値 (1.4 = 44.8px) に
なっていた。`app/globals.css` に他の `*-title` 規則と同型のunlayeredな
`p[data-slot="account-greeting"]` 規則を足し、1規則の中でfontの後にline-heightを
書いてFigmaの1.2を確実に効かせた (生pxは書かずh1トークン経由)。

## 3. SectionHeader (PC `8095:753` / SP `8095:812`)

4節すべて同じ部品。

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 上余白 | 40 / 24 | 40 / 24 | [OK] |
| 枠 | 下余白 | 16 / 12 | 16 / 12 | [OK] |
| 枠 | 揃え | baseline / space-between | baseline / space-between | [OK] |
| 枠 | ブロック高 | 80 / 60 | 81.59 / 61.59 | [OK] Δ1.6注2 |
| 節見出し | font-size / weight | 16 / 500 (`jp/h4`) | 16 / 500 | [OK] |
| 節見出し | line-height | 24 (1.5) | 25.6 (cjk 1.6) | [DS案件] Δ1.6注2 |
| 節見出し | letter-spacing | 0.32 (2%) | 0.48 (cjk 3%) | [DS案件] Δ0.16 |
| 節見出し | 要素 | — | `<h2 data-slot="shelf-title">` | [OK] 注6 |
| 節見出し | 色 | `foreground` #464748 | lab 39.88 | [DS案件] 注3 |
| 右リンク | font-size / lh | 12 / 18 | 12 / 21 | [DS案件] 注2 |
| 右リンク | letter-spacing / 色 | 0.6 / `muted-foreground` | 0.6 / lab 37.41 | [OK] 完全一致 |
| 右リンク | 右端x | 1376 (= 内容右端) / 359 | 1376 / 359 | [OK] 完全一致 |
| 節見出しの文字列 | 4節 | これから / 続き / これまで / お支払い方法 | 同一4節・同順 | [OK] |

注6: 体裁は既存の `h2[data-slot="shelf-title"]` 規則 (h4トークン) をそのまま再利用した
(ジャーナル:カテゴリの棚見出しと同型)。**globals.cssに新しい見出し規則を足していない**。

### 節見出し右リンクの文言と遷移先

| 節 | Figma (PC / SP) | 実装 (PC / SP共通) | 遷移先 | 判定 |
|---|---|---|---|---|
| これから | 予定をすべて見る → / すべて → | 予定をすべて見る → | `/ja/account/subscriptions` | [仕様] 注7 |
| 続き | ジャーナルをすべて見る → / すべて → | ジャーナルをすべて見る → | `/ja/journal` | [仕様] 注7 |
| これまで | 参加履歴をすべて見る → / すべて → | ご注文をすべて見る → | Shopify顧客ポータル (外部) | [仕様] 注8 |
| お支払い方法 | お支払い方法を変更する → / 変更する → | お支払い方法を変更する → | Shopify顧客ポータル (外部) | [仕様] 注7 |

注7: SPの短縮ラベル (「すべて →」「変更する →」) は採らずPCラベルを両幅で使う。
実測でSPでも収まる (最長の「お支払い方法を変更する →」116.69 + 見出し65.92 + gap 16 =
198.6 < 内容幅343) ため、同じ意味のコピーを2系統持つ保守コストを避けた。
→「まとめ確認事項」Q2

注8: 「これまで」の中身を**注文履歴**にしたので (下の5節)、Figmaの見本文言
「参加履歴をすべて見る →」ではなく「ご注文をすべて見る →」にした。遷移先はShopifyの
顧客アカウントポータル (`https://shopify.com/<shop_id>/account`) — 注文明細・再注文は
Shopify側にしか無い。

## 4. カード列 (UpcomingGrid `8095:756` / ContinueGrid `8095:776` / PastExpGrid `8096:120` / PaymentMethodGrid `8144:1251`)

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 列 | 下余白 | 8 / 8 | 8 / 8 | [OK] |
| 列 | gap | 32 / 12 | 32 / 12 | [OK] |
| 3列グリッド | 列幅 | 416 x3 | `416px 416px 416px` | [OK] 完全一致 |
| 2列グリッド | 列幅 | 640 x2 | `640px 640px` | [OK] 完全一致 |
| SP | 並び | 縦積み 全幅343 | `343px` 1列 | [OK] 完全一致 |

## 5. RecordCard (PC `8095:757` / SP `8095:816`) — これから / これまで

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | padding | 20 / 16 | 20 / 16 | [OK] |
| 枠 | 内gap | 8 (縦) / 16 (左右) | 8 / 16 | [OK] |
| 枠 | 角丸 | 4 (`radius-sm`) | 4 (`rounded-sm`) | [OK] 完全一致 注9 |
| 枠 | 背景 | `card` #f4f3ed | lab 95.76 | [OK] 完全一致 |
| 枠 | 並び | PC縦3行 / SP左右2列 | `flex-col` / `flex-row space-between` | [OK] 注10 |
| 枠 | カード高 | 117 / 79 | 123.19 / 107.38 | [OK] PC Δ6注2 / SPは注11 |
| 日付 | font-size / weight | 12 / 400 | 12 / 400 | [OK] |
| 日付 | line-height | 18 (1.5) | 21 | [DS案件] 注2 |
| 日付 | letter-spacing / 色 | 0.6 / `muted-foreground` | 0.6 / lab 37.41 | [OK] 完全一致 |
| 日付 | 文字列の形 | 「8月20日(木) お届け」 | 「8月20日(木) お届け」 | [OK] 完全一致 注12 |
| 見出し | font-size / weight | 14 / 400 | 14 / 400 | [OK] |
| 見出し | line-height | 25.2 (1.8) | 25.2 | [OK] 完全一致 |
| 見出し | letter-spacing / 色 | 0.7 (5%) / `foreground` | 0.56 / lab 39.88 | [OK] Δ0.14 / 色は注3 |
| 補足 | font-size / lh / 色 | 12 / 18 / muted | 12 / 21 / lab 37.41 | [DS案件] 注2 |
| SP補足 | 位置 | 右端寄せ | `justify-between` の右側 | [OK] |
| 左ブロック | 内gap (SP) | 4 | 4 | [OK] |

注9: Figmaの `radius-sm` = 4とTailwind v4の `rounded-sm` (0.25rem = 4) が一致する
(`--shape-radius-sm` も0.25rem)。C5-1で問題になった `radius-lg`(8) vs `rounded-md`(6) の
ズレはこのページには出ない。

注10: PC/SPの並びの切り替えは、左ブロックのラッパをPCで `lg:contents` にして
カード直下の3行に戻す方式。**同じ内容をhiddenで二重描画していない**
(C5-1のCartLineと同じ方針)。

注11: SPのカード高 +28。Figma SPのRecordCardは 左ブロック271 + gap 16 + 補足101 =
388で、カード内幅311を **77超えている** (Figma側は `whitespace-nowrap` +
`overflow-clip` なので、はみ出した補足は見えなくなる)。実装は折り返しを許して
見出しを2行にした (欠落させない方を採った)。→「まとめ確認事項」Q3

注12: 日付は `Intl.DateTimeFormat('ja-JP', {month:'long', day:'numeric', weekday:'short',
timeZone:'Asia/Tokyo'})` で組む。単体テストで「8月20日(木)」を固定している。

## 6. ExpCard (PC `8095:777` / SP `8095:840`) — 続き

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 幅x高さ | 640x120 / 343x72 | 640x120 / 343x72 | [OK] 完全一致 |
| 枠 | padding | 0 (写真がカード端に接する) | 0 | [OK] |
| 枠 | gap | 20 / 16 | 20 / 16 | [OK] |
| 枠 | 揃え / 角丸 / 背景 | center / 4 / `card` | center / 4 / lab 95.76 | [OK] |
| 写真 | 幅x高さ | 160x120 / 96x72 | 160x120 / 96x72 | [OK] 完全一致 |
| 写真 | アスペクト | 4:3 | 4:3 | [OK] |
| 写真 | 画像なしのとき | (Figmaは面のみ) | `ImagePlaceholder` (`bg-muted` + ロゴ10%) | [仕様] 注13 |
| 本体 | 左端x | 244 (= 64+160+20) / 128 | 244 / 128 | [OK] 完全一致 |
| 本体 | 内gap | 4 | 4 | [OK] |
| 本体 | ブロック高 | 47 | 50.19 | [OK] Δ3.2注2 |
| ラベル | font-size / lh / 色 | 12 / 18 / muted | 12 / 21 / lab 37.41 | [DS案件] 注2 |
| 見出し | font-size / lh / weight | 14 / 25.2 / 400 | 14 / 25.2 / 400 | [OK] 完全一致 |
| 本体 | 右余白 | 0 | 20 / 16 (`pr-5` / `pr-4`) | [仕様] 注14 |
| ラベル | 文字列 | 読みかけ / お気に入り | お気に入り (統一) | [仕様] 注15 |

注13: `muted` が `background` とほぼ同値で枠が見えない既知差分があるため、画像が無い
カードは面が背景に溶ける。placeholder表示時だけの話で、実データ (お気に入りは
`imageUrl` を持つ) では写真が入る。[DS案件] (DS一括棚卸しで扱う)。

注14: 見出しがカードの右端に接触しないよう本体に右余白を足した (Figmaは見本文言が
短いため余白が要らなかったが、実データのタイトルは長くなる)。

注15: Figmaの1枚目のラベル「読みかけ」は**読書途中**の状態だが、web側にその状態を
持つデータが無い (`behaviorLog` は閲覧イベントのみで読了/中断を持たない)。存在しない
状態を騙るより、実際に持っている「お気に入り」で統一した。→「まとめ確認事項」Q4

## 7. PaymentMethodCard (PC `8144:1252` / SP `8145:1252`) — お支払い方法

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 幅x高さ | 640x112 / 343x104 | 640x117.59 / 343x109.59 | [OK] 幅完全一致・高さΔ5.6注2 |
| 枠 | padding | 20 / 16 | 20 / 16 | [OK] |
| 枠 | 内gap / 角丸 / 背景 | 8 / 4 / `card` | 8 / 4 / lab 95.76 | [OK] |
| overline | 文字列 | ご登録のカード | ご登録のカード | [OK] |
| overline | font-size | 12 | 12 | [OK] |
| overline | font-weight | 700 (Bold) | 500 | [DS案件] 注16 |
| overline | line-height | 18 (1.5) | 21 (cjk 1.75) | [DS案件] 注16 |
| overline | letter-spacing | 1.5 (12.5%) | 1.8 (cjk 15%) | [DS案件] 注16 |
| overline | 色 | `muted-foreground` | lab 37.41 | [OK] |
| 値の行 | gap / 揃え | 12 / center | 12 / center | [OK] 完全一致 |
| 値の行 | font-size | 14 | 14 | [OK] |
| 値の行 | line-height | 19.6 (1.4 = `en/body-sm`) | 19.6 | [OK] 完全一致 注17 |
| 値の行 | letter-spacing | 0 | 0 (`tracking-normal`) | [OK] 完全一致 |
| 値の行 | 色 | `foreground` #464748 | lab 39.88 | [DS案件] 注3 |
| 値の行 | 文字列 | VISA / •••• 1234 | VISA / •••• 1234 | [OK] 完全一致 |
| 補足 | 文字列 | 変更は、決済画面から。 | 変更は、決済画面から。 | [OK] 完全一致 |
| 補足 | font-size / lh / 色 | 12 / 18 / muted | 12 / 21 / lab 37.41 | [DS案件] 注2 |
| 節 | 変更操作のUI | 無し (節見出しの外部リンク1本のみ) | 無し (同) | [OK] 完全一致 |

注16: overlineは `rule-list.tsx` に既知差分として記録済みのもの (Figmaの
`jp/overline` は12/700/lh 1.5/12.5% だが、`typography.style.overline` のcjk再束縛が
weight 500 / lh 1.75 / 15% で効く)。overlineトークンはsigns / products / journal /
定期便ほか全ページに効くので1ページ都合で動かさない。

注17: ブランドと下4桁は英数字なので、CJKの行間 (1.8) を当てずFigmaの
`en/body-sm` (14 / 1.4 / tracking 0) に合わせた (カートの英字リードと同じ判断)。

### 実データが取れないときの扱い (重要)

**現時点で登録カードの実データは取得できない** — Shopifyアプリ権限
`read_customer_payment_methods` が未付与
(Research: https://app.notion.com/p/3b670c9d064c81739054f6456050f7dc)。
本レーンでは権限追加をしていない (アプリ設定変更は承認が必要なため)。

- `buildAccountView()` は `paymentMethod` を**常にnull** で返す (推測を出さない)
- カードは描かず、節見出しと外部リンクだけ残し、カードの位置に12pxの案内1行
  「ご登録のお支払い方法は、設定画面からご確認いただけます。」を出す
- **「未登録」と断定する表示はしない** (読めないことと登録が無いことは別)
- 上の表の実測値は `PREVIEW_SEED=1` の見本カード (VISA •••• 1234) に対するもの。
  権限が付いたら `lib/account-view.ts` の該当箇所に取得を足すだけで器はそのまま使える
- → follow-up: 権限 `read_customer_payment_methods` の付与判断 (「まとめ確認事項」Q5)

## 8. AccountOpsBand (PC `8095:787` / SP `8095:850`)

| 対象 | 項目 | Figma実測 (PC / SP) | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 面の色 | `card` #f4f3ed | lab 95.76 | [OK] 完全一致 |
| 枠 | 上下padding | 40 / 32 | 40 / 32 | [OK] |
| 枠 | 並び | 横並びspace-between / 縦積みgap16 | 同 / 同 | [OK] |
| 枠 | ブロック高 | 129 / 230 | 129.19 / 171.19 | [OK] PC Δ0.2 / SPは注18 |
| 本文 | font-size | 14 / 12 | 14 / 12 | [OK] 完全一致 |
| 本文 | line-height | 25.2 (1.8) / 18 | 25.2 / 21 | [OK] PC完全一致 / SPは注2 |
| 本文 | 色 | `foreground` | lab 39.88 | [DS案件] 注3 |
| 本文 | 文字列 | 契約・お支払い・お届け先の設定はこちら。好みと記録は、お茶カルテにまとめています。 | 同一 (SPもPC文言) | [OK] 注18 |
| CTA | 幅x高さ | 157x49 | 156.48x49.19 | [OK] Δ0.5 |
| CTA | padding | 20 / 12 | 20 / 12 | [OK] 完全一致 |
| CTA | 角丸 | 4 (`radius-sm`) | 4 | [OK] 完全一致 |
| CTA | 背景 | `primary` #464748 (lab 30.10) | lab 30.05 | [OK] 完全一致 |
| CTA | 文字 | 14 / 400 / lh 25.2 | 14 / 400 / 25.2 | [OK] 完全一致 |
| CTA | 文字色 | `primary-foreground` #f9f8f4 (lab 97.55) | lab 100 (純白) | [DS案件] 注19 |
| CTA | 右端x (PC) | 1376 | 1376 (156.48 + x1219.52) | [OK] 完全一致 |
| CTA | 本数 | 2本 (定期便を管理する / お茶カルテを見る) | **1本** (定期便を管理する) | [仕様] 注18 |

注18: **CTAが1本**。Figmaの2本目「お茶カルテを見る」はwebに遷移先が存在しない
(お茶カルテはcx-agent側 / LINEのカルテで、webにページが無い。`eslint-rules/
no-new-karte-fields.mjs` が示すとおりカルテの正本はcx-agent側)。存在しないURLを
指すボタンは出さない方を採った。SPのブロック高差 -59はこの1本ぶん (49+16) と本文
1行ぶん。SPの本文もFigmaの短縮版ではなくPC文言を使う (注7と同じ理由)。
→「まとめ確認事項」Q6

注19: `primary-foreground` の既知差分 (C5-1注12と同一)。

## 9. 節の出し入れ / 状態網羅

| 状態 | 実装の挙動 | 確認方法 | 結果 |
|---|---|---|---|
| 4節すべてデータあり | 見本で4節・カード9枚 (3+2+3+1) を描画 | PC/SP実測 (節見出し4 / RecordCard 6 / ExpCard 2 / PaymentCard 1) | [OK] |
| これから が空 | 節ごと出さない (見出しも出さない) | 単体テスト `buildUpcoming` (解約済み / 次回請求日なし / 過去日付を除外) | [OK] |
| 続き が空 | 節ごと出さない | 単体テスト `buildContinueItems` | [OK] |
| これまで が空 | 節ごと出さない | 単体テスト `buildPast` (`orders` 無し / 空) | [OK] |
| お支払い方法が読めない | 節見出しと外部リンクは残し、カードの代わりに案内1行 | 実データ経路 (`paymentMethod` は常にnull) + 単体テスト | [OK] |
| ポータルURLが解決できない | 「設定・契約」「ご注文をすべて見る」「お支払い方法を変更する」を描かない (支払方法節ごと非表示) | `customerAccountPortalUrl()` がnullを返す実装 | [OK] |
| 氏名が無い | 「おかえりなさい。」(「さん」だけの挨拶を作らない) | 単体テスト `accountDisplayName` | [OK] |
| 未ログイン (見本なし) | 従来どおりログイン誘導 / LINEのみはLineAccountView | 認証分岐は改変していない | [OK] |
| リンクの遷移先 | 予定→`/ja/account/subscriptions` / 続き→`/ja/journal` / 注文・支払方法・設定→Shopifyポータル / CTA→`/ja/account/subscriptions` | 実測 (`href` 6本) | [OK] |

### 確定版に無いので**実装していない**もの

| 項目 | 確定版の扱い | 本レーンの実装 |
|---|---|---|
| 住所 (お届け先) のCRUD | 画面に無い。案内帯が「お届け先の設定はこちら」と外部へ送る | 作らない (外部リンク1本) |
| お支払い方法の変更UI | 画面に無い (節見出しの外部リンク1本のみ) | 作らない |
| お気に入り / フォローの削除UI | 画面に無い | 本ページから外れる (Q7) |
| 会員ステータス / プラン導線 | 画面に無い | 本ページから外れる (Q7) |
| ログアウトボタン | 画面に無い | Headerが既にログアウトを持つので欠落しない |
| LINE連携エントリ | 画面に無い | **残した** (web側で唯一の入口。`NEXT_PUBLIC_LIFF_ID` 未設定なら非表示) → Q8 |

## 10. ブラウザコンソール

| viewport | HTTP | console error | console warning | pageerror | 横スクロール |
|---|---|---|---|---|---|
| 1440x1000 | 200 | 0 | 0 | 0 | なし (scrollWidth 1440) |
| 375x1000 | 200 | 0 | 0 | 0 | なし (scrollWidth 375) |

`requestfailed` はPC 34件 / SP 14件記録されたが、**すべて `?_rsc=` 付きのNext.js RSC
prefetch** (Header / Footerが全ナビリンクをprefetchし、ブラウザcontextを閉じるときに
in-flight分が `net::ERR_ABORTED` になる)。マイページ固有のURL / APIは含まれない。

## 11. 機械検証 (全件 / FAIL 0)

| コマンド | 結果 |
|---|---|
| `pnpm lint` | PASS (`--max-warnings 0`) |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS 529/529 (97 files。うち本レーン新規20件) |
| `pnpm build` | PASS |
| `pnpm validate:tokens` | PASS 0 error / 20 warning (既存のcamelCase命名warningのみ) |
| `pnpm validate:design-map` | PASS 137 entries (本レーンで8件追加) |

`eslint-suppressions.json` から `app/[locale]/account/page.tsx` の
`elxea-tokens/no-raw-colors` 抑制1件を削除した (書き直しで違反が消え、残置すると
eslintが「もう発生しない抑制がある」でexit 2になるため)。

## 12. まとめ確認事項 (Setaka判断)

| # | 事項 | 推奨 | 影響範囲 |
|---|---|---|---|
| Q1 | 挨拶のリードから季節句「秋の火入れがすすむころ。」を落とした (固定文だと1年のうち9か月は事実と合わない) | 現状維持。季節に追従させたいなら別タスク (月別コピーor Sanity管理) | マイページのみ |
| Q2 | 節見出しの右リンクはSPでもPCラベルを使う (Figmaの「すべて →」「変更する →」を採らない) | 現状維持 (実測でSPに収まる。同義コピーの二重管理を避ける) | マイページのみ |
| Q3 | SPのRecordCardはFigmaだと補足がカード内幅を77超えて隠れる。実装は折り返しを許して2行にした (高さ79 → 107) | 折り返し (欠落させない) | マイページのみ |
| Q4 | 「続き」1枚目のラベル「読みかけ」に対応するデータが無いので「お気に入り」で統一した | 現状維持。読書途中を出したいならbehaviorLogに読了/中断の記録を足す別タスク | マイページのみ |
| Q5 | 支払方法は器のみ (権限 `read_customer_payment_methods` 未付与で実データ経路なし) | 権限を付与するか / この節を当面case-by-caseで隠すかを判断。付与すれば器はそのまま使える | 支払方法の節 |
| Q6 | CTA「お茶カルテを見る」はwebに遷移先が無いので描いていない | webにお茶カルテ画面を作る (別レーン) か、LINE側への導線に差し替えるかを判断 | 案内帯 |
| Q7 | 確定版に無いためマイページから外れた機能: お気に入り/フォローの削除UI・イベント登録キャンセル・会員ステータスとプラン導線・ダッシュボードの件数 | 確定版どおり (=外す) で進める。削除操作の置き場が必要なら別画面として設計 | マイページの機能面 |
| Q8 | LINE連携エントリは確定版に無いが、web側で唯一の入口なので案内帯の後に残した | 残す (消すと連携フローに入れなくなる)。確定版に組み込むならFigma側へ追記 | マイページ末尾 |
| Q9 | 12px系の行間 (18 vs 21) / h4の行間・字間 / `foreground` / `primary-foreground` / overlineのweight・字間 がFigmaと食い違う | DS一括棚卸しタスク (3b670c9d-064c-8166) で扱う。本レーンでは動かしていない | DS全域 |
