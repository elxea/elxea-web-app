# C6-1忠実度対比表 — ログイン / ログイン完了 (roji)

> **[DS トークン整合 2026-08-09 反映] 本表の色の行を読むときの注意**
>
> 本表は各レーンが計測した時点の記録である。その後 DS トークン整合タスク
> (`3b670c9d-064c-8166`) で semantic 色トークンを **Figma R2 確定版の実在値**へ
> 揃えたため、**下表の「旧実装値」で書かれた行は現在は Figma と一致している**
> (行内には `→ 現 #xxxxxx [解決 2026-08-09]` を追記した)。
> `[DS案件]` / `[要確認]` の判定が付いている色の行のうち、下表のトークンに
> 該当するものは**解決済み**として読むこと。
>
> | トークン | 本表に出てくる旧実装値 | 現在の実装値 (= Figma) |
> |---|---|---|
> | `foreground` / `card-foreground` / `popover-foreground` | #5d5e61 (charcoal) | **#464748** (graphite) |
> | `border` / `input` / `ring` | #858581 (ash) | **#888675** |
> | `primary-foreground` | #ffffff (純白) | **#f9f8f4** |
> | `muted` | #ebe9e0 (= `background` と同値) | **#dedccf** |
> | `secondary` | #ffc202 / #ffc10d (金) | **#d5d3c0** (sand) |
> | `destructive` | #b9525c | **#ae4751** (C6-1R で是正済み) |
>
> 実測での裏取り: Chromium (1440x900) + canvas `getImageData` で 10 ページを再計測し、
> 上記の現在値がそのまま解決すること、罫線 `#888675` の外側対比 3.022:1、
> `foreground` の対比 7.655:1 (background) / 8.376:1 (card)、ボタン角丸 8px、
> 金額の円記号が半角 `¥` であることを確認 (console error 0 件)。
> 既知の未達は `border` を `muted` 面の**内側**に引いた場合のみ (2.668:1)。
> 実使用箇所は外側が `background` で 3.022:1 のため後退はない。


- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`【R2: 確定版】
  - **ログイン** section `6702:8970`
    PC frame `6702:8971` / SP frame `6706:14444` / 状態枠 `6706:14468`
    節ノード: Auth Card `6702:9009` (SP `6706:14449`) / Header Block `6702:9010`
    (SP `6706:14450`) / Actions `6702:9014` (SP `6706:14454`) / Separator `6702:9018`
    (SP `6706:14458`) / 同意文 `6702:9024` (SP `6706:14464`) /
    Buttons `6893:17349`・`6893:17352` (SP `6893:17355`・`6893:17358`)
  - **ログイン完了** section `6749:10277`
    PC frame `6749:10278` / SP frame `6750:15880`
    節ノード: Complete Card `6750:10383` (SP `6750:15885`) / Check Circle `6750:10384`
    (SP `6750:15886`) / Heading `6750:10386` (SP `6750:15888`) /
    LinkSuccessBanner `6750:15802` (SP `6750:16048`) / Actions `6750:15804`
    (SP `6750:16050`) / Buttons `6893:17361`・`6893:17364` (SP `6893:17367`・`6893:17370`)
  - Structure List該当行: ログイン https://app.notion.com/33270c9d064c8138bc5fc14540c0fb95 /
    ログイン完了 https://app.notion.com/36b70c9d064c81118e99f515ea5ddd10
- Figma実測: `get_metadata` + `get_design_context` + `get_variable_defs` で当ラウンド中に
  自前取得 (2026-08-08 22:17〜22:25 JST)。**絶対座標は親frameのx/yを積んで算出**し、
  節間の間隔は「前節の下端 → 次節の上端」で出している。
- 実装計測: local production build (`pnpm build` → `SITE_PASSWORD= PORT=3162 next start`) を
  Playwrightで `getComputedStyle` / `getBoundingClientRect` 実測
  (viewport PC 1440x1000 / SP 390x844、locale ja-JP)
  - 計測URL: `/ja/login` / `/ja/login/complete`
  - 計測スクリプト: `scripts/scratch/c61-measure.mjs` (gitignore対象・使い捨て)
  - 計測ログ: `scripts/scratch/c61-measured.json` (gitignore対象)
  - 計測日時: 2026-08-08 22:4x JST
  - **console error / warning / pageerror = 0件**、`document.scrollWidth` = viewport幅
    (PC 1440 / SP 390 — 横スクロール無し)、両ページHTTP 200
- **Vercel Previewでの再計測 (同スクリプト・同値)**:
  https://elxea-web-fgq3imb2n-setaka1103s-projects.vercel.app
  (`/ja/login` / `/ja/login/complete` ともHTTP 200。2026-08-08 22:5x JST)
  - **PC / SPの全比較項目がlocal production buildと完全一致 (差分0件)**、
    console error / warning / pageerror 0件、`scrollWidth` = viewport幅
  - rebase後 (origin/feat/c1-ds-foundation = C5-1カートレーンの6 commitを取り込んだ上) に
    全ゲートを再実行し、同じ数値を再取得している
- 色は測定値のCSS `lab()` をsRGB hexに戻して比較している (CSS `lab()` はD50白色点)。
- 判定: `[OK]` 一致 (Δ≤2px) / `[仕様]` 承認済みor出典付きの意図的差分 /
  `[要判断]` オーナー判断が要る差分 / `[粗]` 修正必須の乖離

## サマリ

| 判定 | 件数 |
|---|---|
| [OK] | 63 |
| [仕様] | 7 |
| [要判断] | 3 |
| **[粗]** | **0** |

**[粗] 0件。** [要判断] 3件はいずれも **DS全体 (semanticトークン / shadcnプリミティブ)
に効く事項**で、C6-1単独で書き換えると全ページの既存忠実度表と並列レーンに波及するため、
本レーンでは正しいsemanticクラス (`bg-card` / `bg-secondary` 等) を使い、値の是正は
Reviewへ切り出している (末尾「要判断の3件」節)。
着手時は4件あったが、`card` トークンの乖離はrebaseで取り込んだC5-1レーンの是正で解消した (注1)。

---

## 1. ページ骨格 — ログイン (Figma 6702:8971 / 6706:14444)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle / Rect) | 判定 |
|---|---|---|---|---|
| Login Section | 上余白 (PC) | 80 (Section y68 → Card y148) | 80 (`md:py-20`) | [OK] |
| Login Section | 下余白 (PC) | 80 (Card下端586 → Section下端666) | 80 (`md:py-20`) | [OK] |
| Login Section | 上余白 (SP) | 48 (Section y100 → Card y148) | 48 (`py-12`) | [OK] |
| Login Section | 下余白 (SP) | 48 (Card下端557 → Section下端605) | 48 (`py-12`) | [OK] |
| Login Section | 左右余白 (SP) | 20 (Card x20 / frame 390) | 20 (`px-5`) | [OK] |
| Login Section | 縦中央寄せ | 無し (通常フローで積む) | 無し (`min-h` / `items-center` を付けない) | [OK] |
| Auth Card | 幅 (PC) | 420 (x510 = 中央寄せ) | 420 / x510 (`mx-auto max-w-105`) | [OK] |
| Auth Card | 幅 (SP) | 350 (390 − 左右20) | 350 / x20 | [OK] |
| Auth Card | padding (PC) | 32 | 32 (`md:p-8`) | [OK] |
| Auth Card | padding (SP) | 24 | 24 (`p-6`) | [OK] |
| Auth Card | 節間gap (PC) | 24 (Header下端126 → Actions 150) | 24 (`md:gap-6`) | [OK] |
| Auth Card | 節間gap (SP) | 20 (Header下端113 → Actions 133) | 20 (`gap-5`) | [OK] |
| Auth Card | 角丸 | 12 (`radius-xl`) | 12 (`rounded-xl`) | [OK] |
| Auth Card | 罫線幅 | 1 (`border-width-1`) | 1 (`border`) | [OK] |
| Auth Card | 罫線色 | `#888675` (`border`) | `#858581 → 現 #888675 [解決 2026-08-09]` (`--color-border`) | [要判断] 注4 |
| Auth Card | 面色 | `#f4f3ed` (`card`) | `#f4f3ed` (`--color-card`) | [OK] 注1 |
| Auth Card | 高さ (PC) | 438 | 450.80 | [仕様] 注5 |
| Auth Card | 高さ (SP) | 409 | 422.00 | [仕様] 注5 |

## 2. 見出しブロック — ログイン (Figma 6702:9010 / 6706:14450)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Header Block | 行間gap | 8 (PC/SP共通) | 8 (`gap-2`) | [OK] |
| Header Block | 幅 (PC) | 356 (420 − padding 64) | 354 (420 − 罫線2 − padding 64) | [OK] |
| Header Block | 揃え | center | `text-align: center` | [OK] |
| Account (kicker) | font-size | 12 (`size/xs`) | 12 | [OK] |
| Account (kicker) | font-weight | 500 (`weight/medium`) | 500 | [OK] |
| Account (kicker) | 行高 | 15 (AUTO) | 16 (`leading-4`) | [OK] |
| Account (kicker) | 色 | `#585854` (`muted-foreground`) | `#585854` | [OK] |
| タイトル | font-size (PC) | 24 (`size/2xl`) | 24 (`h1.auth-card-title` md+) | [OK] |
| タイトル | font-size (SP) | 20 (w186→155の比 = 24×0.833) | 20 (`h1.auth-card-title`) | [OK] |
| タイトル | font-weight | 500 (`Medium`) | 500 (`--typography-weight-medium`) | [OK] |
| タイトル | 行高 (PC) | 29 | 28.80 (24 × 1.2) | [OK] |
| タイトル | 行高 (SP) | 24 | 24.00 (20 × 1.2) | [OK] |
| タイトル | 色 | `#464748` (`foreground`) | `#464748` (`@layer base` のbrand-graphite) | [OK] |
| タイトル | letter-spacing | 0 (`tracking/normal`) | 0.48px (= 0.02em) | [仕様] 注3 |
| タイトル | 要素 | — | `<h1>` (文書構造上の主見出し) | [OK] |
| 説明文 | font-size | 14 (`size/sm`) | 14 | [OK] |
| 説明文 | font-weight | 400 | 400 | [OK] |
| 説明文 | 行高 | 17 (AUTO) | 20 (`leading-5` = DS `Text-sm/Regular`) | [仕様] 注2 |
| 説明文 | 色 | `#585854` | `#585854` | [OK] |
| 説明文 | 折返し行数 (PC/SP) | 2行 | 2行 (block 40) | [OK] |

## 3. アクション列 — ログイン (Figma 6702:9014 / 6706:14454)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Actions | 総高 (PC/SP) | 204 (36 + 16 + 100 + 16 + 36) | **204.00** | [OK] |
| Actions | gap | 16 | 16 (`gap-4`) | [OK] |
| btn1 / btn2 | 高さ | 36 | 36 (Button `size=default` = `h-9`) | [OK] |
| btn1 / btn2 | 左右padding | 16 (`px-4`) | 16 | [OK] |
| btn1 / btn2 | 上下padding | 8 (`py-2`) | 8 | [OK] |
| btn1 / btn2 | 幅 | 356 | 354 (罫線2の差) | [OK] |
| btn1 / btn2 | 角丸 | 8 (`radius-lg`) | 6 (`rounded-md`) | [OK] Δ2 / 注6 |
| btn1 / btn2 | font-size | 14 (`size/sm`) | 14 | [OK] |
| btn1 / btn2 | font-weight | 500 | 500 | [OK] |
| btn1 / btn2 | 行高 | 20 (`leading/5`) | 20 | [OK] |
| btn1 / btn2 | 影 | `0 1px 2px #0000001A` (`shadow-xs`) | `0 1px 2px rgb(0 0 0 / .05)` (`shadow-xs`) | [OK] 注6 |
| btn1 (LINE) | 面色 | `#464748` (`primary`) | `#464748` (`variant=default`) | [OK] |
| btn1 (LINE) | 文字色 | `#f9f8f4` (`primary-foreground`) | `#ffffff` → 現 #f9f8f4 [解決 2026-08-09] | [OK] Δ微 / 注4 |
| btn1 (LINE) | ラベル | 「LINEでログイン」 | 同 (`t("lineButton")`) | [OK] |
| btn1 (LINE) | アイコン | 無し | 無し (旧LINEブランドアイコンを撤去) | [仕様] 注7 |
| btn2 (メール) | 面色 | `#d5d3c0` (`secondary`) | `#ffc202 → 現 #d5d3c0 [解決 2026-08-09]` (`--color-secondary`) | [要判断] 注1 |
| btn2 (メール) | 文字色 | `#464748` (`secondary-foreground`) | `#464748` | [OK] |
| btn2 (メール) | ラベル | 「メールアドレスでログイン」 | 同 (`t("shopifyButton")`) | [OK] |
| btn2 (メール) | 遷移先 | — | `/api/auth/login?locale=ja` (既存OAuth配線を不改変) | [OK] |
| Separator行 | 高さ | 100 | 100 (`h-25`) | [OK] |
| Separator行 | 罫線の溝 | 12 (`space-3`) | 12 (`gap-3`) | [OK] |
| Separator行 | 罫線高 | 1 | 1 (`Separator` = `h-px`) | [OK] |
| Separator行 | 罫線色 | `#888675` (`border`) | `#858581 → 現 #888675 [解決 2026-08-09]` | [要判断] 注4 |
| Separator行 | 罫線幅 (PC) | 148 | 146.03 | [OK] |
| Separator行 | 罫線幅 (SP) | 121 | 119.03 | [OK] |
| 「または」 | font-size / 色 | 12 / `#585854` | 12 / `#585854` | [OK] |

## 4. 同意文 — ログイン (Figma 6702:9024 / 6706:14464)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 同意文 | font-size | 12 (`size/xs`) | 12 | [OK] |
| 同意文 | 行高 | 14 (AUTO) | 16 (`leading-4`) | [OK] Δ2 / 注2 |
| 同意文 | 色 | `#585854` | `#585854` | [OK] |
| 同意文 | 揃え | center | center | [OK] |
| 同意文 | ブロック高 | 28 (2行) | 32 (2行) | [OK] Δ4は行高由来 / 注2 |
| 利用規約 | 下線 | あり | `underline` | [OK] |
| 利用規約 | リンク先 | — | `/ja/legal/terms` | [OK] |
| プライバシーポリシー | 下線 | あり | `underline` | [OK] |
| プライバシーポリシー | リンク先 | — | `/ja/legal/privacy` | [OK] |

## 5. 状態バナー (Figma 5344:3 / 5344:5、配置指示6706:14468)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| バナー | 配置 | 「カード上部に条件表示」 | カード内・最上部 (`?error=` / `?linked=true` 時のみ) | [OK] |
| バナー | 高さ | 44 | 44 (`h-11`) | [OK] |
| バナー | 左右padding | 16 (`space-4`) | 16 (`px-4`) | [OK] |
| バナー | 上下padding | 12 (`space-3`) | 12 (`py-3`) | [OK] |
| バナー | 角丸 | 6 (`radius-md`) | 6 (`rounded-md`) | [OK] |
| バナー | 罫線幅 | 1 | 1 | [OK] |
| バナー | 面色 | `#ebe9e0` (`background`) | `#ebe9e0` | [OK] |
| バナー | font-size / 行高 / 揃え | 14 / 20 / center | 14 / 20 / center | [OK] |
| 成功 | 罫線色 | `#9ecbc0` (`success`) | `#9ecbc0` | [OK] |
| 成功 | 文字色 | `#9ecbc0` (`success`) — 対比 **1.47:1** | `#464748` (`success-foreground`) — 対比 **7.66:1** | [要判断] 注8 |
| 失敗 | 罫線色 | `#ae4751` (`destructive`) | ~~`#ae4751`~~ → **実測は `#b9525c`** / C6-1Rで `#ae4751` に是正 | [C6-1Rで是正] 注10 |
| 失敗 | 文字色 | `#ae4751` — 対比 **4.52:1** (AA合格) | ~~`#ae4751`~~ → **実測は `#b9525c` / 対比3.896:1 (AA未達)** / C6-1Rで `#ae4751` (4.521:1) に是正 | [C6-1Rで是正] 注10 |
| 失敗 | a11y | — | `role="alert"` (既存踏襲) | [OK] |

## 6. ページ骨格 — ログイン完了 (Figma 6749:10278 / 6750:15880)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Complete Section | 上下余白 (PC) | 80 / 80 (Section 563 = 80 + 403 + 80) | 80 / 80 | [OK] |
| Complete Section | 上下余白 (SP) | 48 / 48 (Section 466 = 48 + 370 + 48) | 48 / 48 | [OK] |
| Complete Card | 幅 (PC / SP) | 420 / 350 | 420 / 350 | [OK] |
| Complete Card | padding (PC / SP) | 32 / 24 | 32 / 24 | [OK] |
| Complete Card | 節間gap (PC / SP) | 24 / 20 | 24 / 20 | [OK] |
| Complete Card | 角丸 / 罫線 / 面色 | 12 / 1 / `card` | 同部品を再利用 (§1と同値) | [OK] |
| Complete Card | 高さ (PC) | 403 | 410.80 | [仕様] 注5 |
| Complete Card | 高さ (SP) | 370 | 378.00 | [仕様] 注5 |

## 7. 完了マーク・見出し — ログイン完了 (Figma 6750:10384 / 6750:10386)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Check Circle | 寸法 | 64 × 64 | 64 × 64 (`size-16`) | [OK] |
| Check Circle | 角丸 | full (`radius-full`) | full (`rounded-full`) | [OK] |
| Check Circle | 面色 | `#9ecbc0` (`success`) | `#9ecbc0` (`bg-success`) | [OK] |
| Check Circle | 記号色 | `#f9f8f4` (`primary-foreground`) | `#ffffff` → 現 #f9f8f4 [解決 2026-08-09] | [OK] Δ微 / 注4 |
| Check Circle | 記号 | テキスト「✓」27 × 36 (30px Bold) | lucide `Check` 32 × 32 / strokeWidth 3 | [仕様] 注9 |
| Heading | gap (PC) | 8 | 8 (`md:gap-2`) | [OK] |
| Heading | gap (SP) | 12 | 12 (`gap-3`) | [OK] |
| 「連携完了」 | font-size (PC / SP) | 24 / 20 | 24 / 20 | [OK] |
| 「連携完了」 | font-weight | **700** (`Bold`) | 700 (`data-emphasis="strong"`) | [OK] |
| 「連携完了」 | 行高 (PC / SP) | 29 / 24 | 28.80 / 24.00 | [OK] |
| 「連携完了」 | 色 | `#464748` | `#464748` | [OK] |
| 「連携完了」 | 要素 | — | `<h1>` | [OK] |
| 説明文 | font-size / 色 / 行数 | 14 / `#585854` / 2行 | 14 / `#585854` / 2行 | [OK] |
| 説明文 | 行高 | 17 (AUTO) | 20 (`leading-5`) | [仕様] 注2 |

## 8. バナー・アクション — ログイン完了 (Figma 6750:15802 / 6750:15804)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| LinkSuccessBanner | 表示条件 | 常時 (確定版のカード構成要素) | 常時 | [OK] |
| LinkSuccessBanner | 寸法・体裁 | h44 / px16 / py12 / radius 6 / border success | 同 (§5と同一部品) | [OK] |
| LinkSuccessBanner | 文言 | 「LINEアカウントと連携が完了しました」 | 同 (`t("heading")`) | [OK] |
| Actions | 総高 (PC) | 88 (36 + 16 + 36) | **88.00** | [OK] |
| Actions | 総高 (SP) | 84 (36 + 12 + 36) | **84.00** | [OK] |
| Actions | gap (PC / SP) | 16 / 12 | 16 / 12 (`gap-3 md:gap-4`) | [OK] |
| btn1 | 面色 / 文字色 | `#464748` / `#f9f8f4` | `#464748` / `#ffffff` → 現 #f9f8f4 [解決 2026-08-09] | [OK] Δ微 |
| btn1 | ラベル / 遷移先 | 「お茶を探しに行く」 | 同 / `/ja` (`Link href="/"`) | [OK] |
| btn2 | 面色 | `#d5d3c0` (`secondary`) | `#ffc202 → 現 #d5d3c0 [解決 2026-08-09]` | [要判断] 注1 |
| btn2 | ラベル / 挙動 | 「チャットで相談する」 | 同 / チャットパネルを開く (既存) | [OK] |
| btn1 / btn2 | 高さ / padding / 影 | 36 / px16 py8 / shadow-xs | 同 | [OK] |
| 登場アニメーション | — | Figmaに記載なし | motionでfade+スケール (静止状態は確定版と一致) | [仕様] 注10 |

---

## 注記

### 注1 — `card` / `secondary` のsemanticトークンがFigmaと乖離している【要判断】

Figma variableと `tokens/base.json` の実効値を突き合わせた結果:

Figma variableと `tokens/base.json` の実効値を突き合わせた結果、着手時点で2件ずれていた。
**うち `card` はrebaseで取り込んだC5-1レーンの修正により解消済み**で、残るのは `secondary` 1件。

| token | 実装 (rebase後の実測) | Figma variable | 状態 |
|---|---|---|---|
| `card` | `oklch(0.963 0.008 98.9)` = **#f4f3ed** | **#f4f3ed** | **[OK] 解消** — C5-1が `tokens/base.json` を是正 (旧 #d5d3c0) |
| `secondary` | `oklch(0.846 0.173 85.6)` = **#ffc202 → 現 #d5d3c0 [解決 2026-08-09]** | **#d5d3c0** | [要判断] secondaryボタンが金色になる |

- **`card`**: 着手時は #d5d3c0 (Figmaより3段暗い、Webflow由来のgray-40) だったが、C5-1レーンが
  同じ乖離をカート画面で検出してFigma実在値へ是正した (`tokens/base.json` の当該
  `$description` に経緯が記録されている)。本レーンはrebaseでその修正を取り込んでおり、
  **rebase後の実測値は #f4f3edでFigmaと完全一致**している (§1の面色行)。
  カード上のコントラストもタイトル8.38:1 / 説明文6.43:1でAA達成。
- **`secondary`**: 未是正。Figmaの `secondary` (#d5d3c0) は**是正前の実装の `card` と同値**で、
  実装の階調が1段ずれている疑いが残る (同種のドリフト)。これは本2画面固有ではなく
  `bg-secondary` を使う全ページに効くため、本レーンでは**クラスはsemanticのまま正しく当て、
  値は変えない**。ラベルのコントラストは実装値 (#464748 on #ffc202) でも5.75:1でAA達成のため
  機能上の不具合は無い。→ 是正はReviewへ。

### 注2 — AUTO行高はフォント既定に依存するためDSプリセットを採る【仕様】

Figmaの説明文・同意文は `lineHeight: AUTO`。実測すると14pxで17px、12pxで14px
(いずれも比 ≈ 1.21) で、これは **Interのフォント既定メトリクス**であって設計値ではない
(Figma側の指定フォントはNoto Sans JPだが、Figma環境の代替解決でこの比になっている)。

フォントは本リポの承認済み仕様差分「フォント = **コードが正**」(CLAUDE.md忠実度ゲート §5)
の対象なので、フォント既定に由来する行高も同じくコード側が正となる。値はFigma自身が
DSテキストスタイルとして持つ `Text-sm/Regular` = `size/sm 14` + `leading/5 20` を採用した
(バナー・ボタンではFigmaもこのスタイルを明示バインドしている)。12pxは同系列にtokenが
無いため最も近い `leading-4` (16px、Figma実測14に対し Δ2) を当てた。

### 注3 — 日本語の字送りはDSプリセットが正【仕様】

Figmaのテキストノードは `tracking/normal` (= 0) だが、実装は `:lang(ja)` の
`body` / `h1` プリセット由来で本文0.04em (0.64px)・見出し0.02em (0.48px) が乗る。
このプリセット自体がFigma由来のトークン (`--typography-style-body-tracking` /
`--typography-style-h1-tracking`) で、`app/globals.css` にも
「The tokens are the Figma copy, so they win」と明記された既存の全体方針。
本画面のためだけに打ち消さない。

### 注4 — `border` / `primary-foreground` の微差【要判断 / OK】

`border` は #858581 (実装) vs #888675 (Figma)、`primary-foreground` は #ffffff vs #f9f8f4。
どちらも注1と同じsemanticトークン層の話で、視認上の差はごく小さい。
`primary-foreground` は Δ が知覚閾以下のため [OK]、`border` は罫線が構造要素なので
注1とまとめて [要判断] とした。

### 注5 — カード高さの差は注2の行高差の積み上げ【仕様】

PC 450.80 vs 438 (Δ12.8) / SP 422.00 vs 409 (Δ13)。内訳は
説明文ブロック +6 (34→40) + 同意文ブロック +4 (28→32) + kicker +1 (15→16) +
タイトル −0.2で、**すべて注2 / 注3の行高由来**。padding・gap・各節の寸法は完全一致
(Actions総高がPC/SPともFigmaと1pxの差もなく一致していることが根拠) なので、
骨格のズレではない。

### 注6 — ボタンの角丸と影はshadcnプリミティブの既定を使う【OK / 要判断】

FigmaのButtonsは `radius-lg` = 8px、影は `0 1px 2px #0000001A` (α 0.102)。
実装はshadcn `Button` の `rounded-md` = 6px、`shadow-xs` = `0 1px 2px rgb(0 0 0 / .05)`。
角丸 Δ2pxは本表の [OK] 許容 (Δ≤2px) 内で、かつ `components/ui/button.tsx` は全ページ共通の
プリミティブなのでC6-1で書き換えない (書き換えると全ボタンの見た目が動く)。
影は既存の `outline` variantが使っている `shadow-xs` に合わせた。
DS全体として8px / α0.1に寄せるかはReviewへ (注1と同じ性質)。

### 注7 — LINEブランド緑とブランドアイコンは確定版で消えている【仕様】

旧実装は1つ目のCTAをLINEブランド緑 (`bg-brand-line` / 生色 #06C755) + LINEロゴSVGで
描いていた。**Figma R2確定版 (`6893:17349`) は塗り `primary` #464748・ラベルのみ**で、
アイコンノードを持たない (instanceの子はText 1件だけ)。dev-workflowの非交渉ルール
「Figmaが正本 / 直す方向は常にコードをFigmaに合わせる」に従い確定版へ追従した。

**ボタン自体とLINEログイン機能は消していない** — ラベル「LINEでログイン」も
`/api/line-login/init` → `access.line.me` の直リンク経路 (Universal Link対策のコメント含む)
もそのまま残している。変えたのは配色とアイコンの有無だけ。
ブランド緑を残すか確定版どおりprimaryにするかはReviewへ (末尾)。

なお、この撤去で `line-login-button.tsx` / `login/page.tsx` の生色 (`no-raw-colors`) 抑制が
不要になったため `eslint-suppressions.json` の当該2件を削除した (`pnpm lint` の
「suppressions left that do not occur anymore」を解消するため)。

### 注8 — 成功バナーの文字色だけFigmaから外した【要判断】

Figmaは成功バナーの文字色を罫線と同じ `success` #9ecbc0に置くが、面色 `background`
#ebe9e0との対比は **1.47:1** でWCAG AA (通常テキスト4.5:1) を大きく下回る。
本文が読めない状態を実装するのは不適当と判断し、**罫線はFigmaどおり `success`、文字色のみ
DSの対 (`success-foreground` #464748 / 7.66:1)** にした。
失敗バナーはFigma値 (#ae4751) のままで4.52:1 = AA合格なので変更していない。
Figma側を直すか実装の読み替えを承認するかはReviewへ。

### 注10 — 失敗バナーの実測値は誤記だった【C6-1Rで是正】

上表と注8の「失敗バナーはFigma値 (#ae4751) のまま」は**誤り**。実際には
`tokens/base.json` の `destructive` がFigma Variable `destructive` (#ae4751) から
**#b9525cにドリフト**しており、実装の罫線・文字色はどちらも #b9525cで描かれていた。
面色 `background` #ebe9e0に対する文字色の対比は **3.896:1** でWCAG AA (4.5:1) 未達。

C6-1Rで `destructive` をFigma実在値 #ae4751 (= `oklch(0.537 0.135 17)`) に戻し、
対比 **4.521:1** = AA合格にした。詳細と全使用箇所のbefore/afterは
`docs/fidelity/c6-1r-fidelity.md`。

### 注9 — 完了マークの記号はlucideアイコンに置換【仕様】

Figmaは30px Boldのテキストグリフ「✓」。実装はアイコンをlucideに寄せる本リポの作法
(`components/ui/*` / CLAUDE.md「アイコンのみのボタンにはaria-label」等の系列) に合わせ
`Check` (32 × 32 / strokeWidth 3 / `aria-hidden`) を使った。円・色・寸法はFigmaと一致。

### 注10 — 登場アニメーションはFigma未記載の実装側追加【仕様】

完了画面のfade + スプリングは旧実装から引き継いだものでFigmaには無い。
**静止後の状態は確定版と一致**しており (本表の計測は1.5秒待機後 = アニメーション完了後)、
忠実度に影響しない。

---

## 要判断の3件 (Reviewへ回す事項)

| # | 事項 | 実装の現状 | 推奨 |
|---|---|---|---|
| 1 | `--color-secondary` が #ffc202 → 現 #d5d3c0 [解決 2026-08-09] (Figma #d5d3c0) | クラスは `bg-secondary` のまま | `tokens/base.json` をFigma値へ是正。`card` と同じ「1段ずれ」の疑いで、C5-1が `card` を直した続きに当たる。全ページ影響のため独立タスク化 |
| 2 | 成功バナーの文字色 (Figma 1.47:1) | `success-foreground` に読み替え (7.66:1) | 実装の読み替えを承認or Figma側を修正して再凍結 |
| 3 | LINE CTAのブランド緑・アイコン撤去 | 確定版どおりprimary / アイコン無し | 確定版どおりで確定 (ブランド緑を残すならFigmaに戻す) |

補足: ボタン角丸8→6px (注6) は [OK] 許容内だが、DSとしてFigmaに合わせるなら
`components/ui/button.tsx` の変更 = 全ページ影響のため、上記 #1と同じ
「DSトークン是正」タスクにまとめるのが妥当。
