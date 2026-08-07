# C4-3忠実度対比表 — プレイリスト一覧 / プレイリスト詳細

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - プレイリスト一覧PC `8085:4299` / SP `8085:4353`
  - プレイリスト詳細PC `8089:4518` / SP `8089:4622`
- 実装計測: local production build (`next build` → `next start` :3103) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport PC 1440x1000 / SP 375x1000)
  - 一覧: `/ja/playlists`
  - 詳細: `/ja/playlists/morning-forest`
- 計測日時: 2026-08-08 07:2x JST
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 / `[未実測]` データ未整備でDOMに出ないため未計測

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
| ブロック間 | 特集枠→Toolbar | 32 | 32 (margin-top) | [OK] |
| Chip | 高さ | 44 | 44 | [OK] |
| グリッド | 列構成 | 2列163.5 / gap 16 | `163.5px 163.5px` / gap 16 | [OK] |
| グリッド | row-gap | 32 | 32 | [OK] |
| Rail | 位置 | グリッドの下に積む | `order-3` / margin-top 32 | [OK] |

## 3. プレイリスト詳細 — PC 1440 (Figma 8089:4518)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| PlaylistHead | 上余白 (Breadcrumbまで) | 48 | 48 (padding-top) | [OK] |
| PlaylistHead | 下余白 | 32 (924→956) | 32 (padding-bottom) | [OK] |
| BreadcrumbRow | 枠の高さ | 44 (タップ域) | 44 (`min-h-11`) | [OK] |
| Photo | 左端x / 寸法 | 64 / 640x800 (4:5) | 64 / 640x800 | [OK] |
| HeroText | 左端x / 幅 | 736 / 640 | 736 / 640 | [OK] |
| HeroText | 写真上端からのオフセット | +96 (124→220) | 96 (margin-top) | [OK] |
| 主見出し | font-size / line-height | 38px相当 (h38) | 44px / 52.8 | [仕様] 注1 |
| 主見出し | class | — | `page-title mt-5 text-foreground` | [OK] 注2 |
| HeroText | キッカー→見出し | 20 (17→37) | 20 (margin-top) | [OK] |
| HeroText | 見出し→サブ見出し | 28 (75→103) | 28 (margin-top) | [OK] |
| HeroText | サブ見出し→リード | 20 (130→150) | 20 (margin-top) | [OK] |
| HeroText | リード→罫線 | 4 (200→204) | 4 (margin-top) | [OK] |
| HeroText | 罫線→Stats | 23 (205→228) | 24 (padding-top) | [OK] Δ1注5 |
| HeroText | Stats→選盤ラベル | 36 (263→299) | 36 (margin-top) | [OK] |
| HeroText | 選盤ラベル→クレジット | 5 (317→322) | 4 (margin-top) | [OK] Δ1注5 |
| Stats | 数字font-size | 28px相当 (h35) | 32px (h1トークン) | [仕様] 注6 |
| Stats | 列間 | 48 (150→198) | 48 (`lg:gap-x-12`) | [OK] |
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

## 4. プレイリスト詳細 — SP 375 (Figma 8089:4622)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| PlaylistHead | 上余白 | 24 | 48 (padding-top) | [仕様] 注9 |
| Photo | 寸法 | 375x469 (全幅4:5) | 343x428.8 (カラム幅4:5) | [仕様] 注10 |
| HeroText | 左端x / 幅 | 16 / 343 | 16 / 343 | [OK] |
| 主見出し | font-size | 32px | 32px | [OK] |
| HeroText | 写真→HeroText | 32 (561→593) | 56 (margin-top) | [仕様] 注11 |
| 節 (共通) | 上余白 | 64 | 64 (padding-top) | [OK] |
| 節見出し | キッカー→見出し | 8 (81→89) | 8 (margin-top) | [OK] |
| 節 (共通) | 見出し→本体 | 56 (116→172) | 56 (margin-top) | [OK] |
| 3カラム | 列構成 | 縦積み | `343px` (1列) | [OK] |
| カード写真 | 寸法 | 375x234 / 375x250 (全幅) | 343幅 / 8:5・3:2 | [仕様] 注10 |

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
- **注6 — Statsの数字**: Figmaは28px相当だが28pxのタイポトークンが無い。
  生px禁止のため最も近い `typography.style.h1` (32px) を採用。
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
- **注10 — SP写真の全幅**: Figma SPはアートワーク・カード写真をページ余白の外まで
  伸ばす (375幅)。実装はページカラム幅 (343) に収めた。全幅化は負のマージンで
  ページの水平スクロールを起こしやすく、他SPページ (ジャーナル・商品) も
  カラム幅で揃えているため、一貫性を優先した。
- **注11 — SP写真→HeroText**: Figma 32に対し56。PCの `lg:mt-24` (96) と同じ
  ユーティリティ列で段階を作っており、SPは `mt-14` (56)。次ラウンドで
  Setaka判断があれば32に寄せられる (単一クラス変更)。

---

## 参照元

- Figma file `AWLnI0XF07e8rScuxPYPc7` (node 8085:4299 / 8085:4353 / 8089:4518 / 8089:4622)
  取得2026-08-08 06:4x JST (`get_metadata` / `get_screenshot`)
- 実装計測ログ: Playwrightスクリプト実行2026-08-08 07:2x JST (local prod build :3103)
- 実装: `app/[locale]/playlists/page.tsx` / `app/[locale]/playlists/[slug]/page.tsx` /
  `components/playlist/playlist-detail.tsx`
