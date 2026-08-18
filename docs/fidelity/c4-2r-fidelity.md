# C4-2R忠実度対比表 — 微修正ラウンド (カテゴリ見出し / 日付表記 / 記事側見出し文言 / SP写真全幅)

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - ジャーナル:カテゴリ索引PC `8083:4073` / SP `8083:4217`
  - ジャーナル:タグSP `8082:4048` (カテゴリSPの間隔を判定するための兄弟ノード)
  - プレイリスト詳細SP `8089:4622` / PC `8089:4518`
  - プレイリスト一覧SP `8085:4353` (訂正15の根拠)
- Figma実測: `get_metadata` で当ラウンド中に自前取得 (2026-08-08 11:2x JST)。
  絶対座標は親frameのx/yを積んで算出している。
- 実装計測: `next build` → `VERCEL_ENV=preview PORT=3108 next start` をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport PC 1440x1000 / SP 375x812)
  - 計測スクリプト: `scripts/scratch/c42r-measure.mjs` (gitignore対象)
  - 計測日時: 2026-08-08 11:4x JST
- **Vercel Previewでの再計測 (同スクリプト・同値)**:
  https://elxea-web-8ujsyip9o-setaka1103s-projects.vercel.app
  (2026-08-08 12:0x JST。57項目すべてlocal prodと一致 / console・pageerror 0件)
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 / `[要判断]` Figmaから値が一意に導けない /
  `[未実測]` データ未整備でDOMに出ないため未計測

---

## スコープ1 — カテゴリ索引Head→NavBar (Figma 8083:4073 / 8083:4217)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| PC | Head下端→NavBar上端 | **64** (TitleRow下端abs357 = 68+112+177 → NavBar abs421) | **64.00** | [OK] |
| PC | Toolbar margin-top | 64 | `64px` (`lg:mt-16`) | [OK] |
| PC | Chip高さ | 44 | 44.00 | [OK] |
| PC | 水平スクロール | — | scrollWidth 1440 = innerWidth 1440 | [OK] |
| SP | Head下端→Chips上端 | 0 (CategoryStackHead枠abs312 = Chips上端abs312) | **32.00** | [要判断] 注1 |
| SP | Chip高さ | 44 | 44.00 | [OK] |
| SP | 水平スクロール | — | scrollWidth 375 = innerWidth 375 | [OK] |

**着手前の実装値はPC 48 (`lg:mt-12`)** で、C4-2 QAが未申告乖離F-1 (MID) として挙げていた
差分 Δ16px。本ラウンドで64 (`lg:mt-16`) に是正し Δ0になった。

## スコープ2 — 日付表記 `YYYY.MM.DD`

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| カテゴリ索引Meta | 最終更新の表記 | `最終更新 2026.08.05` (8083:4084 / 8083:4227) | `7 カテゴリ ・ 全 22 本 ・ 最終更新 2026.02.01` | [OK] |
| journal一覧 カード | 日付の表記 | `2026.08.05` 形式 | `2026.02.01` / `2026.01.20` / `2026.01.15` (6件すべて `^\d{4}\.\d{2}\.\d{2}$`) | [OK] |
| journal一覧 特集メタ | 日付の表記 | 同上 | `コラム — 2025.12.15` | [OK] |
| 記事詳細header | 日付の表記 | 同上 | `2026.02.01` | [OK] |
| 記事詳細header | `<time datetime>` | — | `2026-01-31T15:00:00.000Z` (機械可読値はISOを保持) | [OK] |

着手前は `toLocaleDateString(locale)` でロケール書式 (`2026/1/31`) を出しており、
C4-2 QAがF-2 (LOW) として挙げていた表記差。`lib/format-date.ts` の
`formatArticleDate` に一本化して解消した。

- 適用箇所 (8箇所): `components/journal/article-card.tsx` /
  `components/journal/related-articles.tsx` / `app/[locale]/journal/page.tsx` /
  `app/[locale]/journal/[slug]/page.tsx` / `app/[locale]/journal/category/page.tsx` /
  `app/[locale]/playlists/page.tsx` / `app/[locale]/playlists/[slug]/page.tsx` (2)
- 取引系の日付 (注文・定期便・イベント・メール) は対象外。ロケール依存の長い表記を
  意図して使っているため触っていない。

## スコープ3 — 記事詳細の関連商品見出し

| 対象 | 項目 | 変更前 | 変更後 | 判定 |
|---|---|---|---|---|
| `journal.teaInArticle` (ja) | 文言 | この記事に出てきた茶葉 | **この記事に合わせたい茶葉** | [OK] |
| `journal.teaInArticle` (en) | 文言 | Tea in this story | **Teas to pair with this story** | [OK] |
| キー | copy-as-data | `journal.teaInArticle` | 同一 (キーは据え置き) | [OK] |
| 描画 | 節の表示 | — | Sanity全22記事が `relatedProducts` 未設定のため節ごと非表示 | [未実測] 注2 |

配信されたページのメッセージ束に新文言が載っており、旧文言は残っていないことを実測で確認
(`この記事に合わせたい茶葉` = 有 / `この記事に出てきた茶葉` = 無)。

## スコープ4 — プレイリスト詳細SP写真の全幅化 (Figma 8089:4622)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| SPアートワーク | 幅 / 左端x | 375 / 0 (8089:4629) | **375.00 / 0.00** | [OK] |
| SPアートワーク | 高さ (4:5) | 469 | 468.75 (375 x 4/5) | [OK] Δ0.25注3 |
| SPアートワーク | 角丸 | 0 (ページ端に接する) | `0px` | [OK] |
| SPカード写真 | 幅 / 左端x | 375 / 0 (8089:4693等) | **375.00 / 0.00** | [OK] |
| SPカード写真 | 角丸 | 0 | `0px` | [OK] |
| SP HeroText | 左端x / 幅 | 16 / 343 | 16.00 / 343.00 | [OK] 注4 |
| SP | 水平スクロール | — | `documentElement.scrollWidth` 375 = `innerWidth` 375 / `body.scrollWidth` 375 | [OK] 注5 |
| PCアートワーク | 幅 / 左端x / 高さ | 640 / 64 / 800 | 640.00 / 64.00 / 800.00 | [OK] 注6 |
| PCカード写真 | 幅 / 左端x | 416 / 64 | 416.00 / 64.00 | [OK] 注6 |
| PCアートワーク | 角丸 | — | `6px` (従来どおり) | [OK] 注6 |
| PC | 水平スクロール | — | scrollWidth 1440 = innerWidth 1440 | [OK] |

## 追加スコープ — C4-3 QA Failの是正

| 指摘 | 対象 | 変更前 (実測) | 変更後 (実測) | 判定 |
|---|---|---|---|---|
| F1 (MID) | プレイリスト詳細「LISTEN / 配信で聴く」節 | PC/SPとも描画 | **PC/SPとも不在** (`LISTEN` / `配信で聴く` / `録音日` の文字列0件) | [OK] |
| F5 (LOW) | 詳細BreadcrumbRow高さ (Figma 44) | 48 | **44.00** (PC / SPとも。`min-height 44px` / 行内 `nav` の `margin-bottom` `0px`) | [OK] |
| F2 (MID) | `docs/fidelity/c4-3-fidelity.md` Stats関連5行 | `[OK]` / `[仕様]` (実測済み表記) | `[未実測]` 注8 + 訂正12 | [OK] |
| F3 (LOW) | 同表のFigma値誤読2件 | 主見出し「38px相当」/ Stats「28px相当」 | 両方 **32px** に訂正 (訂正13)。注6は撤回 | [OK] |
| F4 (LOW) | 同表SP一覧「特集枠→Toolbar: Figma 32」 | Figma 32と断定 | frame間0 / コンテンツ間48を併記し `[要判断]` へ格下げ (訂正15) | [OK] |

---

## 注記

- **注1 — カテゴリSPのHead→Chips間隔は32を維持【要判断】**: Figma SPの
  `CategoryStackHead` (8083:4221) は枠の下パディングが無く、枠下端abs312が
  そのままChips上端abs312になるため **Figma上は0** と読める。一方PCの同じ枠は
  下パディング64を持っており (abs357→421)、SPだけ0になるのは枠の作り落ちの可能性が高い。
  兄弟の**タグSP (8082:4048) はPageHeadのテキスト下端abs178 → Chips abs210 = 32**
  で、こちらがSPの意図と読める。本ラウンドの指示は「48→64」というPC値の1点なので、
  SPは既存の32 (`mt-8`) を維持し、0 / 32のどちらを正とするかはデザイン側の確定に回す。
- **注2 — 見出し文言の描画は未実測**: Sanityの全22記事で `relatedProducts` (Shopify
  ハンドル配列) が未設定のため、「空枠を出さない」方針どおり節ごとDOMに出ない
  (C4-2で同じ状況を確認済み)。文言の正本は `messages/ja.json` / `messages/en.json` の
  `journal.teaInArticle` で、配信HTMLのメッセージ束に載っていることを実測した。
  編集側で1件でも紐付けが入れば同じ手順で節ごと実測できる。
- **注3 — Δ0.25**: 375 x 4/5 = 468.75。Figmaの469は整数丸め。アスペクト比4:5は一致。
- **注4 — 写真だけ全幅・本文は余白内**: Figma SPはPhoto frameだけをx0 w375に置き、
  kicker/見出し/リード/Statsはx16 w343に残す。実装も同じ分担 (HeroTextは16/343のまま)。
- **注5 — 水平スクロールを出さない仕組み**: `.sp-full-bleed` (`app/globals.css`) は
  `margin-inline: calc(var(--page-margin) * -1)` で、`.page-container` の
  `padding-inline` と**同一トークン**を負に取る。したがって要素の外幅は
  コンテナ自身の幅と等しくなり、コンテナ幅を超えることが構造上ありえない。
  `100vw` を使う実装はdesktopでスクロールバー幅ぶん溢れるため採用していない。
  lg以上では `margin-inline: 0` に戻すのでPCのカラム内寸は不変。
- **注6 — PC非回帰**: 全幅化はSPのみ。PC (lg以上) のアートワーク640x800 x64 /
  カード写真416 x64 / 角丸6pxはいずれも着手前と同値で、回帰していないことを実測で確認した。
- **注7 — 日付のタイムゾーンをAsia/Tokyoに固定**: `formatArticleDate` は
  `Intl.DateTimeFormat` に `timeZone: "Asia/Tokyo"` を渡す。SanityのdatetimeはUTC (`…Z`)
  で入るため、実行環境のTZ (VercelはUTC) で組むとJST夜に公開した記事が1日前に見える。
  実測例: `datetime="2026-01-31T15:00:00.000Z"` (= JST 2026-02-01 00:00) が
  `2026.02.01` と描かれる。サーバ / クライアントのどちらで描いても同じ文字列になるため
  hydrationも安定する。
- **注8 — `locale` propの削除**: 日付がロケール非依存になったことで
  `ArticleCard` / `RelatedArticles` の `locale` propは用途が消滅したため削除した
  (呼び出し側9箇所も更新)。使われないpropを残すとドリフト源になるため。
- **注9 — スコープ外として残した既知差分**: プレイリスト詳細SPの「写真→HeroText」は
  Figma 32に対し実装56 (`mt-14`)。C4-3の注11で宣言済みの差分で、本ラウンドの4点指定に
  含まれないため未変更。単一クラス変更 (`mt-14` → `mt-8`) で寄せられる。次ラウンド候補。

---

## 機械検証

| コマンド | 結果 |
|---|---|
| `pnpm lint` | exit 0 (`--max-warnings 0`) |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 93 files / 469 tests passed (うち `__tests__/format-article-date.test.ts` 6件を新規追加) |
| `pnpm build` | exit 0 |
| `pnpm validate:tokens` | 0 error / 20 warning (既存のcamelCase警告のみ) / 302 tokens |
| `pnpm validate:design-map` | OK — 105 entries |
| `pnpm validate:design-kit` | in sync (components=61 / conflicts=8 / known_gaps=18) |
| ブラウザconsole / pageerror | **0件** (カテゴリ索引PC/SP・journal一覧・記事詳細・プレイリスト詳細PC/SP) |

---

## 参照元

- Figma file `AWLnI0XF07e8rScuxPYPc7` (node 8083:4073 / 8083:4217 / 8082:4048 /
  8089:4622 / 8089:4518 / 8085:4353) — `get_metadata` 取得2026-08-08 11:2x JST
- 実装計測ログ: `scripts/scratch/c42r-measure.mjs` 実行2026-08-08 11:4x JST
  (local prod build / `VERCEL_ENV=preview` でサイトパスワードgateを外して計測)
  および同スクリプトをVercel Previewに対して再実行 2026-08-08 12:0x JST
  (https://elxea-web-8ujsyip9o-setaka1103s-projects.vercel.app / 全項目同値)
- Preview到達確認 (HTTP 200): `/ja` `/ja/journal` `/ja/journal/category`
  `/ja/journal/category/recipe` `/ja/journal/tag/5de53eded6f9` `/ja/playlists`
  `/ja/playlists/morning-forest` (`/en/*` は既存のlocaleリダイレクトで `/ja` へ301 → 200)
- C4-2 QA監査 (F-1 / F-2の出所): task `3b570c9d-064c-81cd-bb1a-eaab822e086c`
- C4-3 QA監査 (F1〜F5の出所): task `3b670c9d-064c-81af-b00e-cae93f0f6a5c`
- 変更ファイル: `app/globals.css` / `lib/format-date.ts` /
  `components/journal/article-card.tsx` / `components/journal/related-articles.tsx` /
  `components/playlist/playlist-detail.tsx` /
  `app/[locale]/journal/category/page.tsx` / `app/[locale]/journal/page.tsx` /
  `app/[locale]/journal/[slug]/page.tsx` / `app/[locale]/playlists/page.tsx` /
  `app/[locale]/playlists/[slug]/page.tsx` / `messages/ja.json` / `messages/en.json` /
  `__tests__/format-article-date.test.ts` / `docs/fidelity/c4-3-fidelity.md`
