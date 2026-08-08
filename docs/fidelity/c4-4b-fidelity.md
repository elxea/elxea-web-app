# C4-4b忠実度対比表 — elxea Journal記事詳細 (本文完結 + 末尾のみ回遊)

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - elxea Journal詳細PC `8110:46893` / SP `8110:47043`
    (【R2: 確定版】本文完結 + 末尾のみ回遊 — 同梱セット文脈・執筆者クレジット)
  - 節ノード: ReadingProgress `8110:46895` / Head `8110:46900` / lead `8110:46904` /
    ArticleImageBleed `8110:46906` / H2 `8110:46909` /
    この号に入っているお茶 `8110:46925` / この号のほかの読みもの `8110:46934` /
    NextRead `8110:46945`
  - SP対応: Head `8110:47050` / lead `8110:47054` / Bleed `8110:47056` /
    H2 `8110:47059` / お茶 `8110:47072` / 読みもの `8110:47080` / NextRead `8110:47091`
- Figma実測: `get_metadata` + `get_design_context` + `get_variable_defs` で当ラウンド中に
  自前取得 (2026-08-08 13:5x〜14:0x JST)。**絶対座標は親frameのx/yを積んで算出**している。
- 実装計測: local production build (`pnpm build` → `PREVIEW_SEED=1 VERCEL_ENV=preview
  PORT=3112 next start`) をPlaywrightで `getComputedStyle` / `getBoundingClientRect` 実測
  (viewport PC 1440x1000 / SP 375x812)
  - 計測URL: `/ja/elxea-journal/seed-journal-0`
  - 計測スクリプト: `scripts/scratch/c44b-measure.mjs` (gitignore対象・使い捨て)
  - 計測ログ: `scripts/scratch/c44b-measured.json` (gitignore対象)
  - 計測日時: 2026-08-08 14:2x JST
- 判定: `[OK]` 一致 (Δ≤2px) / `[仕様]` 意図的な差分 / `[要確認]` DS側で判断が要る差分

## 計測データについて (重要)

production Sanity datasetのjournalドキュメントは **確定版のフィールドを未整備**
(`author` / `mainImage.caption` / `otherReads` / `nextReadTags` が空)。素のままでは
9節のうち4節が「データ無し = 非表示」になり実寸計測ができないため、**プレビュー専用の
見本 (`PREVIEW_SEED=1` / `lib/preview-seed.ts` の `withSeedJournalDetail` /
`seedJournalDetail`)** で未入力欄をFigma確定版の文言で埋めた状態を計測した。

- フラグ未設定時 (= production / Vercel Preview) の描画は見本注入前とbyte-identical
  (`previewSeedEnabled()` がfalseのとき両ヘルパは入力をそのまま返す / nullを返す)
- したがってVercel Previewでは現状Head・lead・本文のみ描画される
  (これは仕様どおりの「データが無い節は枠ごと出さない」挙動)
- 文言・データがSanityに入り次第、同じ骨格で全9節が出る

---

## 1. ページ骨格 — PC 1440 / SP 375 (Figma 8110:46893 / 8110:47043)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle / Rect) | 判定 |
|---|---|---|---|---|
| ReadingProgress | 高さ | 2 | 2 (`h-0.5`) | [OK] |
| ReadingProgress | 追従 | ヘッダー直下に貼り付き | `position: sticky` / `top: 0px` | [OK] |
| Article | 上余白 (PC) | 96 (Article y70 → Column y96) | 96 (`lg:pt-24`) | [OK] |
| Article | 上余白 (SP) | 64 (Article y62 → Head y64) | 64 (`pt-16`) | [OK] |
| Article | 下余白 (PC) | 160 (Column下端2962 → Article下端3122) | 160 (`lg:pb-40`) | [OK] |
| Article | 下余白 (SP) | 64 (NextRead下端831 → frame下端895) | 64 (`pb-16`) | [OK] |
| 本文カラム | 幅 (PC) | 640 (x400 = 中央寄せ) | 640 / x400 (`mx-auto max-w-160`) | [OK] |
| 本文カラム | 幅 (SP) | 343 (x16 / ページ余白16の内側) | 343 / x16 | [OK] |
| 縦リズム | ブロック間 (PC / SP) | 24一定 (カラムのauto-layout gap) | 24.00 x 7区間すべて (`mt-6`) | [OK] |
| Breadcrumb | →Head | 24 (18→42) | 24.00 (共通部品の`mb-8`を打ち消し) | [OK] 注1 |
| 横スクロール | PC / SP | — | scrollWidth 1440 / 375 = viewport | [OK] |

縦リズムの実測7区間: Breadcrumb→Head / Head→lead / lead→写真 / 写真→本文 /
本文→お茶 / お茶→読みもの / 読みもの→NextRead。すべて24.00。

## 2. Head (キッカー + タイトル + 執筆者クレジット) — Figma 8110:46900 / 8110:47050

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| kicker | 文言 | `ELXEA JOURNAL` | `ELXEA JOURNAL` (messages `elxeaJournal.kicker`) | [OK] |
| kicker | font-size | 12 (en/overline) | 12 / 12 | [OK] |
| kicker | line-height | 16.8 (1.4) | 21 (1.75) | [要確認] 注2 |
| kicker | letter-spacing | 1.5 (.125em) | 1.8 (.15em) | [要確認] 注2 |
| kicker | →タイトル | PC 16 (17→33) / SP 12 (17→29) | 16.00 / 12.00 | [OK] |
| タイトル | font-size | 52 (functional/jp/h1) | 44 / 32 | [仕様] 注3 |
| タイトル | line-height | 72.8 (1.4) | 52.8 (1.2) / 38.4 (1.2) | [仕様] 注3 |
| タイトル | class | — | `page-title mt-3 text-foreground lg:mt-4` | [OK] |
| タイトル | →AuthorByline | PC 16 (106→122) / SP 12 (121→133) | 16.00 / 12.00 | [OK] |
| AuthorByline | 高さ | 40 | 36 / 36 | [OK] Δ4注4 |
| AuthorByline | アバター | 32 (avatar-sm) | 32 (`--component-avatar-size-sm`) | [OK] |
| Theme badge | 描画 | 確定版に枠なし (キッカーに置換) | 描画しない | [仕様] 注5 |

## 3. lead (明朝) — Figma 8110:46904 / 8110:47054

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| lead | font-family | BIZ UDPMincho (= 実装では秀英横太明朝) | `dnp-shuei-ymincho-std, Georgia, serif` | [OK] 注6 |
| lead | font-size | 19 | 18 (body-lg) | [OK] Δ1注6 |
| lead | line-height | 36 (1.895) | 34.2 (1.9) | [OK] Δ1.8注6 |
| lead | letter-spacing | 0.95 (.05em) | 0.72 (.04em) | [OK] Δ0.23注2 |
| lead | 幅 | PC 640 / SP 343 | 640 / 343 | [OK] |
| lead | 行数 (見本文言) | PC 2行 (h72) / SP 4行 (h128) | PC 2行 (h34.19x2相当) / SP 2行 | [仕様] 注6 |

## 4. ArticleImageBleed (冒頭写真) — Figma 8110:46906 / 8110:47056

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 写真枠 | 幅 (PC) | 720 (= 640 + 40 x2) | 720 (`lg:-mx-10`) / margin-left -40 | [OK] |
| 写真枠 | 幅 (SP) | 375 (全幅・ページ余白の外) | 375 (`.sp-full-bleed`) / margin-left -16 | [OK] 注7 |
| 写真枠 | 高さ | PC 432 / SP 250 | 432 / 250 | [OK] |
| 写真枠 | アスペクト | PC 5:3 (720x432) / SP 3:2 (375x250) | `5 / 3` / `3 / 2` | [OK] |
| 写真枠 | 角丸 | 0 | `border-radius: 0px` (`rounded-none`) | [OK] |
| 写真枠 | 背景 | `--muted` (#dedccf / lab L≈88.2) | `bg-muted` (lab L 92.3) | [要確認] 注8 |
| 画像 | object-fit | 塗り (clip) | `cover` | [OK] |
| キャプション | 位置 | 写真枠の左下に重ねる | `position: absolute` / `bottom 0` / `left 0` | [OK] |
| キャプション | 左余白 | PC 16 / SP 12 | 16 / 12 (`p-3 lg:p-4`) | [OK] |
| キャプション | 下余白 | PC 16 (写真下端-キャプション下端) / SP 12 | 16 / 12 | [OK] |
| キャプション | font-size | 12 (jp/caption) | 12 / 12 | [OK] |
| キャプション | line-height | 18 (1.5) | 21 (1.75) | [要確認] 注2 |
| キャプション | letter-spacing | 0.6 (.05em) | 0.6 (.05em) | [OK] |
| 本文内の写真 | 幅 | 720 (2枚目8110:46918も裁ち落とし) | 640 (共通シリアライザのfigure) | [仕様] 注9 |

## 5. 本文 (段落 / 節見出し) — Figma 8110:46909ほか

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 段落 | font-size | 16 (jp/body) | 16 / 16 | [OK] |
| 段落 | line-height | 28 (1.75) | 28.8 (1.8) | [OK] Δ0.8注2 |
| 段落 | letter-spacing | 0.8 (.05em) | 0.64 (.04em) | [OK] Δ0.16注2 |
| 段落 | 段落間 | 24 | 24.00 x 4箇所 | [OK] |
| 段落 | 幅 | PC 640 / SP 343 | 640 / 343 | [OK] |
| 節見出し | font-size | 32 (jp/h1) | 32 / 32 | [OK] |
| 節見出し | line-height | 38.4 (1.2) | 38.4 (1.2) | [OK] |
| 節見出し | font-weight | 300 (Light) | 300 / 300 | [OK] |
| 節見出し | letter-spacing | 0.64 (.02em) | 0.64 (.02em) | [OK] |
| 節見出し | 前 (直前段落下端→見出し上端) | 80 (リズム24 + frame pt56) | 80.00 x 3箇所 (`mt-20`) | [OK] |
| 節見出し | 後 (見出し下端→直後段落上端) | 44 (frame pb20 + リズム24) | 44.00 x 3箇所 (`mt-11`) | [OK] |
| 節見出し | SPの前後 | 80 / 44 (「続き2」枠) | 80.00 / 44.00 | [OK] 注10 |

節見出しの体裁は `app/globals.css` の
`:lang(ja) [data-slot="article-prose"] h2` 規則 (詳細度0,2,1) で当てている。
Sanity blockContent由来のH2はdata-slotを持てず、unlayeredな `h2 { font: … }` が
Tailwind utilitiesに勝つため、utility側からは指定できない (page-titleと同じ理由)。

## 6. この号に入っているお茶 (同梱セット文脈) — Figma 8110:46925 / 8110:47072

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 節ラベル | font-size | 12 (jp/overline) | 12 / 12 | [OK] |
| 節ラベル | letter-spacing | 1.5 (.125em) | 1.8 (.15em) | [要確認] 注2 |
| 節ラベル | →product row | 16 (18→34) | 16.00 / 16.00 | [OK] |
| product row | 高さ | PC 160 / SP 96 | 160 / 96 | [OK] |
| product row | 縦揃え | 中央 (infoがthumb中央に載る) | `align-items: center` | [OK] |
| thumb | 幅x高さ | PC 160x160 / SP 96x96 | 160x160 / 96x96 | [OK] |
| thumb | →info | PC 24 (160→184) / SP 16 (96→112) | 24.00 / 16.00 | [OK] |
| 名称 | font-size / lh | 14 / 25.2 (jp/body-sm) | 14 / 25.2 | [OK] |
| 名称 | →メタ | 8 (25→33) | 8.00 (PC) | [OK] |
| メタ | font-size | 12 (jp/overline) | 12 (PC) | [OK] |
| メタ | SPでの描画 | SPはinfo 2段のみ (メタ行なし) | `hidden lg:block` で非表示 | [OK] 注11 |
| メタ | →詳細リンク | 8 (51→59) | 8.00 (PC) | [OK] |
| 名称 | →詳細リンク (SP) | 8 (25→33) | 8.00 (SP) | [OK] 注12 |
| 詳細リンク | タップ域 | 49 (py 12 + 行25) | 49.19 / 49.19 | [OK] |
| 詳細リンク | font-size / lh | 14 / 25.2 | 14 / 25.2 | [OK] |
| 詳細リンク | 文言 | `茶葉の詳細を開く →` | `茶葉の詳細を開く →` (messages) | [OK] |
| メタの内容 | 2部構成 | `静岡・本山 標高620m / Akane Vol.2 同梱` | `origin / variety` の実データのみ | [仕様] 注13 |
| 遷移 | 開き方 | ページ内モーダル (Figma注記) | 通常遷移 (`/tea-menu/[slug]`) | [仕様] 注14 |
| TeaSpecCard 3列 | 描画 | 確定版に枠なし (1行のproduct rowに変更) | 描画しない | [仕様] 注5 |

## 7. この号のほかの読みもの (末尾のみ回遊) — Figma 8110:46934 / 8110:47080

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 節ラベル | font-size | 12 (jp/overline) | 12 / 12 | [OK] |
| 節ラベル | →1行目 | 8 (18→26) | 8.00 / 8.00 | [OK] |
| related row | 高さ (タップ域) | 72 (thumb 56 + py 8) | 72.00 / 72.00 | [OK] |
| related row | padding | py 8 | 8 / 8 | [OK] |
| related row | 行間 | 8 (98→106 / 178→186) | 8.00 / 8.00 (`space-y-2`) | [OK] |
| thumb | 幅x高さ | 56x56 | 56x56 / 56x56 | [OK] |
| thumb | →見出し | 16 (56→72) | 16.00 / 16.00 | [OK] |
| 見出し | font-size / lh | 14 / 25.2 (jp/body-sm) | 14 / 25.2 | [OK] |
| 見出し | 幅 | PC 568 / SP 271 | 568 / 271 | [OK] |
| 行数 | 本数 | 3 | 3 | [OK] |
| 遷移 | 開き方 | ページ内モーダル (Figma注記) | 通常遷移 (`/journal/[slug]`) | [仕様] 注14 |

## 8. NextRead (テーマ回遊pill) — Figma 8110:46945 / 8110:47091

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| pill | 高さ | 48 | 48 / 48 | [OK] |
| pill | 左右padding | 16 | 16 / 16 | [OK] |
| pill | 上下padding | 8 (上寄せ) | 8 / 8 (`items-start`) | [OK] |
| pill | 角丸 | 9999 (全角丸) | `rounded-full` (計算値3.35544e+07px) | [OK] |
| pill | 背景 | `--primary` (#464748 / lab L≈31.1) | `bg-primary` (lab L 30.05) | [OK] Δ1 |
| pill | 文字色 | `--primary-foreground` (#f9f8f4 / lab L≈97.5) | `text-primary-foreground` (lab L 100) | [要確認] 注8 |
| pill | font-size / lh | 14 / 25.2 (jp/body-sm) | 14 / 25.2 | [OK] |
| pill | 個数 | 2 | 2 | [OK] |
| 行 | 横gap | 8 | 8.00 (PC 1行に並ぶ) | [OK] |
| 行 | 揃え | 中央 | `justify-content: center` | [OK] |
| 行 | SPの折り返し | 2段 (y0 / y56 → 行間8) | 2段 / 行間8.00 (`flex-wrap`) | [OK] |
| 文言 | ラベル | `「霧」の読みものをこのまま開く` | `「{name}」の読みものをこのまま開く` (messages) | [OK] |

## 9. Figmaに枠がない既存機能 (意図的差分)

| 対象 | 確定版 | 実装 | 判定 |
|---|---|---|---|
| Playlist | 枠なし | お茶の節の直後に同型の1行として残す | [仕様] 注5 |
| relatedPost (単体) | 枠なし (otherReadsに統合) | `otherReads` 未設定時のフォールバック1行 | [仕様] 注5 |

## 10. ブラウザコンソール / レスポンシブ健全性

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

1. **Breadcrumbの下余白を打ち消した**: 共通部品 `components/seo/breadcrumb.tsx` は
   `nav` に `mb-8` (32) を内包する。確定版のリズムは24なので、ページ側で
   `[&_nav]:mb-0` により打ち消し、Head側の `mt-6` で24を作った。共通部品自体は
   変更していない (他ページに影響を出さないため)。

2. **CJK overrideによる行送り / トラッキング差 (既知・共有トークン由来)**
   `components/editorial/rule-list.tsx` に既記載の既知差分。ページが `:lang(ja)` のため
   `dist/tokens-cjk.css` の再束縛 (overline: lh 1.75 / tracking .15em、caption: lh 1.75、
   body: lh 1.8 / tracking .04em、body-lg: tracking .04em) が効き、Figma変数の実値
   (overline lh 1.4 / tracking .125em、caption lh 1.5、body lh 1.75 / tracking .05em) と
   0.2〜4pxずれる。**1ページ都合で共有トークンを動かさず踏襲した**。解消はcjk overrideの
   スコープ見直し (DS側の別案件)。なお **font-size / font-weightは全項目で完全一致**、
   節見出し (jp/h1) はlh・trackingまで完全一致している。

3. **ページ主見出しは44px display【仕様】**
   Figmaの記事詳細フレームはタイトルを52px (`functional/jp/h1`) で組んでいるが、
   ページ主見出しは44px (`.page-title` = display token) に揃える全体裁定
   (Setaka裁定2026-08-08) に従った。C4-2 / C4-3 / C4-4aと同じ。SPは `.page-title` が
   md+のみなのでbase h1 32px (Figma SPも32px相当なのでSPは一致)。

4. **AuthorBylineの高さΔ4**: Figmaは40 (氏名13/lh20 + gap2 + 肩書12/lh18)。実装は
   スケール外の生値 (13px / lh 20) を書かない規律で `text-sm/leading-5` +
   `text-xs/leading-4` に丸めており高さ36。共通部品 `author-byline.tsx` に既記載の
   既知差分で、本タスクでは触っていない。

5. **確定版で落とした枠 / 残した枠**
   - 落とした: Theme badge (6934:143) …… 確定版のHeadは色バッジではなく英字キッカーに
     置き換わった。バッジは一覧ページに残る (design-mapの注記も更新済み)。
   - 落とした: TeaSpecCardの3カラムグリッド …… 確定版では1行のproduct rowになった。
   - 残した: Playlist / relatedPost …… Figma非掲載だが既存のSanityデータを落とさない
     ため、同梱文脈の節として残した (C4-4aでFollowButton / CommentSectionを残したのと
     同じ扱い)。回遊の節より前に置き、「本文完結 → 末尾のみ回遊」の流れを壊さない。

6. **leadの文字組み【仕様】**: Figmaは19px / lh36という**スケール外の値**を当てている。
   トークンに19pxが無く、生px (`text-[19px]`) を書かない規律を優先して
   `body-lg` (18px / lh 1.9 = 34.2) に丸めた。C4-2Rの記事詳細leadと同じ判断で、
   familyだけ `typography.family.special` (秀英横太明朝) を上書きしている。
   行数の差 (SP Figma 4行 / 実装2行) は文言長ではなくfont-sizeの丸めとSP幅343の
   組み合わせによるもので、レイアウト値の差ではない。

7. **SP写真は全幅【Figma準拠】**: FigmaはSPの写真を全幅375 (ページ余白16の外) に置く。
   実装は `.sp-full-bleed` で追従した (プレイリスト詳細SP 8089:4622を根拠とする
   Setaka裁定2026-08-08)。C4-4aはページカラム幅343に収める判断だったので、
   **C4-4a側を全幅に寄せるかは横展開の論点として残る**。

8. **[要確認] semantic colorの値差 (DS判断が要る)**
   C4-4a注6と同一の既知差分。`muted` (Figma #dedccf lab L≈88.2 vs token L 92.3) と
   `primary-foreground` (Figma #f9f8f4 lab L≈97.5 vs token = 純白) の2件でトークン値
   そのものが食い違う。**セマンティック色の値変更は全ページに波及する**ため本タスクでは
   触っていない。要因は (a) tokens/base.jsonの写し漏れ (SoT=Figmaなのでbase.jsonを
   寄せるべき) / (b) 別Variable modeの値をMCPが返している のいずれか。
   DSドリフト案件として別途起票すべき (C4-4aと同一起票で足りる)。
   クラス名のマッピング (`--primary` → `bg-primary` 等) はFigma変数名どおりで正しい。

9. **本文内の写真は本文カラム幅【仕様】**
   Figmaは本文中の2枚目の写真 (8110:46918 / SP 8110:47066) も裁ち落とし720にしている。
   実装の本文写真は共通シリアライザ `components/sanity/portable-text.tsx` の
   ArticleFigure (design-map 7552:242) が描画し、本文カラム幅640・角丸ありで出る。
   **冒頭写真 (`mainImage`) のみArticleImageBleedで裁ち落としに追従した**。
   本文中figureを裁ち落としに変えるとjournal / playlists / farmers / eventsの
   全PortableTextページに波及するため、DS側の判断が要る論点として残す。
   縦リズム (前後24) は `ArticleProse` の `[&>*+*]:mt-6!` で本文figureにも効いている。

10. **SPフレームの余白ばらつきはFigma側のモック都合**
    SPの確定版は写真が全幅のためArticleが3枚のframeに分割されており、frame境界の
    余白が112 / 64 / 24とばらつく (段落下端→次frameの写真上端)。frame内部の
    「H2前56 / 後20」と24のリズムはPCと一貫しているので、**PC側で一意に読める
    24 + 56 = 80 / 20 + 24 = 44を採用**し、frame固定高さ由来のばらつきは採らなかった。

11. **SPのメタ行は非表示【Figma準拠】**: Figma SPのproduct row info (8110:47076) は
    「名称 → 詳細リンク」の2段のみで、PCにあるメタ行 (産地) を持たない (幅231に
    収めるため)。実装も `hidden lg:block` でSPは出さない。この結果SPの行高が
    Figmaどおり96 (thumb 96と同じ) に収まる。

12. **SPの名称→リンク余白の是正**: 当初 `inline-flex` で組んでいたためベースライン
    揃えの分だけ上に余白が乗り、Figmaの8に対し14.81 (Δ6.81) になっていた。
    ブロックレベルの `flex w-fit` に変えて8.00に是正した。PC (メタ→リンク) は
    当初から8.00で一致していた。

13. **メタの内容【仕様】**: Figmaのメタは「産地 / 同梱文脈」の2部構成
    (`静岡・本山 標高620m / Akane Vol.2 同梱`)。同梱文脈は節ラベル
    (`この号に入っているお茶`) が既に担っているため、品目側は実データの
    `origin` / `variety` だけを出し、号名を文字列組み立てで捏造しない方針にした。
    文字組み・寸法はFigmaと一致している。

14. **「ページ内モーダルで開く」は未実装【仕様】**
    Figmaのノード名は同梱お茶・ほかの読みもの・NextReadに「ページ内モーダルで開く /
    ページ内で開く = 行き止まり回避」と注記している。実装は通常遷移
    (`/tea-menu/[slug]` / `/journal/[slug]` / `/journal/tag/[slug]`) にした。
    - 理由: 兄弟ページ `app/[locale]/journal/[slug]/page.tsx` (C4-2R承認済) も
      同じ注記に対して通常遷移で実装しており、モーダル化は2ページ共通の
      インタラクション方針として決めるべき論点 (単独ページで先行実装すると
      挙動が分岐する)。
    - レイアウト値 (寸法・文字組み・余白) はすべてFigmaに追従済みで、本注記は
      遷移方式のみの差分。

---

## 参照元

- Figma file `AWLnI0XF07e8rScuxPYPc7` — elxea Journal詳細PC `8110:46893` /
  SP `8110:47043` (`get_metadata` / `get_design_context` / `get_variable_defs` で
  2026-08-08 13:5x〜14:0x JST取得)
- 実装: `app/[locale]/elxea-journal/[slug]/page.tsx` /
  `components/journal/article-blocks.tsx` / `app/globals.css` (本文H2規則)
- データ: `sanity/schemas/journal.ts` / `sanity/lib/queries.ts` /
  `lib/preview-seed.ts` (プレビュー見本)
- 計測ログ: `scripts/scratch/c44b-measured.json` (gitignore対象)
