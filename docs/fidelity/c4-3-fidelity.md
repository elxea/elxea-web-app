# C4-3忠実度対比表 — プレイリスト一覧 / プレイリスト詳細

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - プレイリスト一覧PC `8085:4299` / SP `8085:4353`
  - プレイリスト詳細PC `8089:4518` / SP `8089:4622`
- 実装計測: local production build (`next build` → `next start` :3103) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport PC 1440x1000 / SP 375x1000)
  - 一覧: `/ja/playlists`
  - 詳細: `/ja/playlists/morning-forest`
- 計測日時: 2026-08-08 07:2x JST
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 / `[未実測]` データ未整備でDOMに出ないため未計測 /
  `[要判断]` Figmaから値が一意に導けずデザイン側の確定が必要
- **改訂 2026-08-08 (C4-2R)**: C4-3 QA監査の指摘を反映して訂正12〜16を追記し、
  該当行の判定を差し替えた。SP写真の全幅化 (注10) はこのラウンドで実装済み。

---

## 1. プレイリスト一覧 — PC 1440 (Figma 8085:4299)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| PageHead | 主見出しfont-size | 52px (h73 = 52 x 1.4) | 44px | [仕様] 注1 |
| PageHead | 主見出しline-height | 72.8 (1.4) | 52.8 (1.2) | [仕様] 注1 |
| PageHead | 主見出しclass | — | `page-title text-foreground` | [OK] 注2 |
| PageHead | 左端x / 幅 | 64 / 1312 | 64 / 1312 | [OK] |
| PageHead | キッカー→見出し | 12 (17→29) | 12 (row-gap) | [OK] |
| PageHead | 見出し→リード | 12 (102→114) | 12 (row-gap) | [OK] |
| ブロック間 | PageHead→特集枠 | 48 (222→270) | 48 (margin-top) | [OK] |
| 特集枠 | 幅 | 1312 | 1312 | [OK] |
| 特集枠 | 高さ | 718 | 708.4 | [OK] Δ9.6注3 |
| 特集枠 | 見出しfont-size | 26px (h38相当) | 24px (h2) | [OK] 注3 |
| ブロック間 | 特集枠→Toolbar | 48 (988→1036) | 48 (margin-top) | [OK] |
| Toolbar | 高さ | 44 | 44 | [OK] |
| Chip | 高さ | 44 | 44 | [OK] |
| Chip | 角丸 | 全丸め (pill) | `3.35544e+07px` (rounded-full) | [OK] |
| Chip | font-size | 14px (h25) | 14px / lh 25.2 | [OK] |
| ブロック間 | Toolbar→Main | 48 (1080→1128) | 48 (margin-top) | [OK] |
| Main | 列構成 | 936 + gap32 + 344 | `936px 344px` / column-gap 32 | [OK] |
| PlaylistList | カード幅 | 452 | `452px 452px` | [OK] |
| PlaylistList | column-gap | 32 (484-452) | 32 | [OK] |
| PlaylistList | row-gap | 64 (460 pitch - 396) | 64 | [OK] |
| PlaylistRail | 幅 / 左端x | 344 / 1032 (64+968) | 344 / 1032 | [OK] |
| MoreRow | 高さ / 角丸 | 48 / pill | C4-1共有部品 (`MoreRow`) を再利用 | [OK] 注4 |

## 2. プレイリスト一覧 — SP 375 (Figma 8085:4353)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| PageHead | 主見出しfont-size | 32px | 32px (base h1 / `.page-title` はmd+ のみ) | [OK] |
| PageHead | 左端x / 幅 | 16 / 343 | 16 / 343 | [OK] |
| ブロック間 | PageHead→特集枠 | 32 | 32 (margin-top) | [OK] |
| ブロック間 | 特集枠→Toolbar | frame 間 0 / コンテンツ間 48 (lead 下端 635 → Chips 683) | 32 (margin-top) | [要判断] 注15 |
| Chip | 高さ | 44 | 44 | [OK] |
| グリッド | 列構成 | 2列163.5 / gap 16 | `163.5px 163.5px` / gap 16 | [OK] |
| グリッド | row-gap | 32 | 32 | [OK] |
| Rail | 位置 | グリッドの下に積む | `order-3` / margin-top 32 | [OK] |

## 3. プレイリスト詳細 — PC 1440 (Figma 8089:4518)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| PlaylistHead | 上余白 (Breadcrumbまで) | 48 | 48 (padding-top) | [OK] |
| PlaylistHead | 下余白 | 32 (924→956) | 32 (padding-bottom) | [OK] |
| BreadcrumbRow | 枠の高さ | 44 (タップ域) | 44 (C4-2R で是正。`min-h-11` + 行内で `[&_nav]:mb-0`) | [OK] 訂正14 |
| Photo | 左端x / 寸法 | 64 / 640x800 (4:5) | 64 / 640x800 | [OK] |
| HeroText | 左端x / 幅 | 736 / 640 | 736 / 640 | [OK] |
| HeroText | 写真上端からのオフセット | +96 (124→220) | 96 (margin-top) | [OK] |
| 主見出し | font-size / line-height | **32px** (jp/h1 token。h38 は box 高 = 32 x 1.2) | 44px / 52.8 | [仕様] 注1 / 訂正13 |
| 主見出し | class | — | `page-title mt-5 text-foreground` | [OK] 注2 |
| HeroText | キッカー→見出し | 20 (17→37) | 20 (margin-top) | [OK] |
| HeroText | 見出し→サブ見出し | 28 (75→103) | 28 (margin-top) | [OK] |
| HeroText | サブ見出し→リード | 20 (130→150) | 20 (margin-top) | [OK] |
| HeroText | リード→罫線 | 4 (200→204) | 4 (margin-top) | [未実測] 注8 / 訂正12 |
| HeroText | 罫線→Stats | 23 (205→228) | 24 (padding-top) | [未実測] 注8 / 訂正12 |
| HeroText | Stats→選盤ラベル | 36 (263→299) | 36 (margin-top) | [未実測] 注8 / 訂正12 |
| HeroText | 選盤ラベル→クレジット | 5 (317→322) | 4 (margin-top) | [OK] Δ1注5 |
| Stats | 数字font-size | **32px** (en/h1 token) | 32px (h1トークン) | [未実測] 注8 / 訂正12・13 |
| Stats | 列間 | 48 (150→198) | 48 (`lg:gap-x-12`) | [未実測] 注8 / 訂正12 |
| 節 (共通) | 上余白 (キッカーまで) | 96 | 96 (padding-top) | [OK] |
| 節 (共通) | 下余白 | 46〜48 | 48 (padding-bottom) | [OK] |
| 節見出し | キッカー→見出し | 8 (113→121) | 8 (margin-top) | [OK] |
| 節見出し | font-size | 20px (h27) | 20px | [OK] |
| 節見出し | line-height | 27 (1.35) | 29 (CJK h3 1.45) | [仕様] 注7 |
| 節 (共通) | 見出し→本体 | 52 (148→200) | 52 (margin-top) | [OK] |
| 3カラム | 列構成 | 3列416 | `416px 416px 416px` | [OK] |
| 3カラム | column-gap | 32 (448-416) | 32 | [OK] |
| カード | 写真→見出し | 16 (460→476) | 16 (margin-top) | [OK] |
| カード | 見出し→note | 4 (500→504) | 4 (margin-top) | [OK] |
| 引用帯 (Quote) | 反転面 / 中央寄せ | 反転面・中央 | `bg-foreground text-background` / `text-center` | [未実測] 注8 |
| 引用帯 | 上余白 / 引用幅 | 88 / 640 | `lg:pt-22` (88) / `max-w-160` (640) | [未実測] 注8 |
| TRACKS | 本文カラム幅 | 640 (サイドバー無し) | `max-w-160` (640) | [未実測] 注8 |
| TRACKS | 曲間 / 番号→曲名 / 曲名→メモ | 48 / 5 / 20 | `gap-12` (48) / `mt-1` (4) / `mt-5` (20) | [未実測] 注8 |
| PLAYLIST DATA | 列構成 | 4列304 / gap 32 | 既存 `SpecBand` (C3-2で検証済) | [未実測] 注8 |
| LISTEN 節 | 節の有無 | Figma に存在しない | C4-2R で削除 (旧実装の残置) | [OK] 訂正16 |

## 4. プレイリスト詳細 — SP 375 (Figma 8089:4622)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| PlaylistHead | 上余白 | 24 | 48 (padding-top) | [仕様] 注9 |
| Photo | 寸法 | 375x469 (全幅4:5) | 375x468.75 (`.sp-full-bleed` 4:5) | [OK] 注10 |
| HeroText | 左端x / 幅 | 16 / 343 | 16 / 343 | [OK] |
| 主見出し | font-size | 32px | 32px | [OK] |
| HeroText | 写真→HeroText | 32 (561→593) | 56 (margin-top) | [仕様] 注11 |
| 節 (共通) | 上余白 | 64 | 64 (padding-top) | [OK] |
| 節見出し | キッカー→見出し | 8 (81→89) | 8 (margin-top) | [OK] |
| 節 (共通) | 見出し→本体 | 56 (116→172) | 56 (margin-top) | [OK] |
| 3カラム | 列構成 | 縦積み | `343px` (1列) | [OK] |
| カード写真 | 寸法 | 375x234 / 375x250 (全幅) | 375幅 / 8:5・3:2 (`.sp-full-bleed`) | [OK] 注10 |

---

## 注記

- **注1 — ページ主見出しは44px統一**: Figmaは一覧52px / 詳細38pxと揃っていないが、
  Setaka裁定「ページ主見出しは44px display (`.page-title`) で統一」に従い両ページ44px。
  C4-1 / C4-2と同じ扱い (SPはbase h1 32pxのまま = `.page-title` はmd+ のみ)。
- **注2 — C4-3スコープ1の是正点**: 一覧のh1は着手前class無し (base 32px) だった。
  `page-title` を当てて44pxに是正済 (PC実測44px / lh 52.8)。
- **注3 — 特集枠**: 高さ・見出しサイズの差は本文の折り返し行数とトークン丸め由来。
  枠・余白・写真比 (1312:546) は一致。部品はジャーナル一覧と同一 (`HeroFeature`)。
- **注4 — MoreRow**: 表示は「残り件数 > 0」のときだけ。計測時はSanityのプレイリストが
  2件で残り0だったためDOMに出ない。部品自体はC4-1で検証済の共有部品。
- **注5 — Δ1**: Figmaの23 / 5はTailwind spacing scale (4px刻み) に無い値。
  生pxを書かない規律により24 / 4に丸めた。
- **注6 — 撤回 (訂正13へ)**: 当初「Figmaは28px相当なので32pxに丸めた」と書いたが、
  Figmaの実指定は32px (en/h1 token) であり丸めは発生していない。実装と完全一致。
- **注7 — CJK line-height**: 日本語の行送りはDS側で1.45。Figmaの1.35との差は
  C4-1以降と同じ扱いで【仕様】。
- **注8 — 未実測 (データ未整備)**: 引用帯 / TRACKS / PLAYLIST DATA / 合わせるお茶 /
  ARTISTSはC4-3で追加したSanityフィールド (`curatorQuote` / `tracks` /
  `dataBand` / `pairedTeas` / `artists`) を根拠に描画する。計測時点で全プレイリストが
  未入力のため、空枠を出さない方針どおりDOMに出ずgetComputedStyleが取れない。
  表の値は実装クラス → pxの対応 (Figma実測から導いた値) を示す。
  なお3カラム部品 (`PhotoCardGrid`) はOTHER PLAYLISTS節で実測済 (416x3 / gap32) で、
  ARTISTS・合わせるお茶も同一部品を使うため寸法は同値になる。
  `SpecBand` はC3-2 (商品詳細 / 定期便) で実測検証済の既存部品。
  → 残る真の未実測は `CuratorQuote` と `TrackList` の2部品。編集側でデータが
  1件入り次第、同じ手順で実測できる。
- **注9 — SP上余白**: Figma SPは24だが、PC/SPで同一の `PlaylistHead` 枠を使うため
  48で通した (Breadcrumb行の高さ44を確保するタップ域と揃える)。
- **注10 — SP写真の全幅 (C4-2Rで解消)**: Figma SPはアートワーク・カード写真を
  ページ余白の外まで伸ばす (375幅)。C4-3時点の実装はページカラム幅 (343) に
  収めており【仕様】差分としていたが、Setaka裁定 (2026-08-08) でFigmaどおり全幅に
  変更した。実装は `.sp-full-bleed` (`app/globals.css`) = 負マージンを
  `--page-margin` (= `.page-container` の `padding-inline` と同一トークン) に
  取る方式で、要素の外幅がコンテナ幅を超えないため水平スクロールは発生しない
  (`100vw` は使わない。desktopでスクロールバー幅ぶん溢れるため)。lg以上では
  マージンを0に戻し、PCのカラム内寸 (640 / 416) は不変。角丸は端に接するSPでのみ落とす。
  実測は `docs/fidelity/c4-2r-fidelity.md` 参照。
- **注11 — SP写真→HeroText**: Figma 32に対し56。PCの `lg:mt-24` (96) と同じ
  ユーティリティ列で段階を作っており、SPは `mt-14` (56)。**C4-2Rのスコープ外
  (4点指定に含まれない) のため未変更**。単一クラス変更 (`mt-14` → `mt-8`) で
  32に寄せられるので、次ラウンドの候補として残す。


### C4-2R での訂正 (2026-08-08 / C4-3 QA 監査 3b670c9d-064c-81af-b00e-cae93f0f6a5c の指摘を反映)

- **訂正12 — Stats関連5行の実測ステータス**: 「リード→罫線 4」「罫線→Stats 24」
  「Stats→選盤ラベル 36」「Stats数字 32px」「Stats列間 48」を [OK]/[仕様] から
  **[未実測] 注8** に是正した。罫線・Statsは `tracks` 未入力のときDOMに描画されないため、
  計測時のpreviewでは実測できていない (表の値は実装クラス→pxの対応)。
  「Stats→選盤ラベル 36」については、実測された36pxはStatsが不在だったため
  実際には「リード→選盤ラベル」の間隔であり、表のラベルと計測対象が一致していなかった。
- **訂正13 — Figma値の誤読2件**: (1) 詳細の主見出しは **32px** (jp/h1 token)。
  「38px相当」はテキストboxの高さ (32 x 1.2 = 38.4) を font-size と読み違えたもの。
  44pxへ揃える裁定 (注1) 自体は有効なので【仕様】区分は変わらない。
  (2) Statsの数字も **32px** が実指定で、実装32pxと完全一致。丸めは無く注6は撤回した。
- **訂正14 — パンくず行の高さ**: 実測48 (Figma 44) の原因は `Breadcrumb` 自身が持つ
  `mb-8` (32) が flex行の高さに乗っていたこと。行側で `[&_nav]:mb-0` を当てて44に是正した
  (`Breadcrumb` の既定マージンは他ページ用にそのまま残す)。
- **訂正15 — SP一覧「特集枠→Toolbar 32」の根拠**: Figmaからは一意に導けない。
  frameは HeroFeature (8085:4359) 下端683 = Chips (8085:4365) 上端683 で**間隔0**、
  コンテンツ基準ではlead下端635 → Chips 683 で**48**。実装の32はどちらでもない。
  ジャーナル一覧SPと同じ32で揃えている実装上の一貫性はあるが、SoT上の裏づけが無いため
  **[要判断]** に格下げした。0 / 32 / 48 のどれを正とするかはデザイン側の確定が必要。
- **訂正16 — LISTEN節の削除**: Figma R2確定版の7ブロック構成に無い「LISTEN / 配信で聴く」節
  (Spotify・SoundCloud・YouTubeリンク + 録音日) がPC/SPとも描画されていた。旧実装の残置で
  仕様差の宣言も無かったため、C4-2Rで削除した。Sanityの `spotifyUrl` /
  `soundcloudUrl` / `youtubeUrl` / `dateRecorded` はschemaとqueryに残す (入力済みデータを
  壊さないため) が描画しない。配信リンクの枠が必要ならFigma側に追加・凍結してから実装する。

---

## 参照元

- Figma file `AWLnI0XF07e8rScuxPYPc7` (node 8085:4299 / 8085:4353 / 8089:4518 / 8089:4622)
  取得2026-08-08 06:4x JST (`get_metadata` / `get_screenshot`)
- 実装計測ログ: Playwrightスクリプト実行2026-08-08 07:2x JST (local prod build :3103)
- 実装: `app/[locale]/playlists/page.tsx` / `app/[locale]/playlists/[slug]/page.tsx` /
  `components/playlist/playlist-detail.tsx`
