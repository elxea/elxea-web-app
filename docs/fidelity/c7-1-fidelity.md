# C7-1イベント詳細 — 忠実度対比表 (Figma実測vs getComputedStyle)

- 対象ページ: `/ja/events/[slug]` (計測は `/ja/events/seed-event-1`)
- Figma正本: file `AWLnI0XF07e8rScuxPYPc7` / section **6657:7931**
  「イベント詳細 変A（部品ベース）— PC/SP @/ja/events/[slug]」
  - PC frame **6657:7932** (1440x2005) / SP frame **6662:8160** (390x1919)
  - Structure DB行: https://app.notion.com/36b70c9d064c81c4b223cee751c6a5ae
- 実装値の取得方法: 実画面をChromiumで開き `getComputedStyle` +
  `getBoundingClientRect` で実測 (ハーネス `scripts/c71-measure.mjs`、
  出力 `/tmp/c71-measure.json`)。位置は**ページ最上部からの絶対座標**
  (`rect + window.scrollY`) で算出し `scrollIntoView` は使わない。
- 計測ビューポート: PC 1440x900 / SP 390x844 (どちらもstatus 200)
- 判定の凡例:
  - `[OK]` 一致 (Δ≤2pxは一致扱い。理由を併記)
  - `[仕様]` 意図的にプロジェクト裁定・DSトークンへ寄せた差分
  - `[DS案件]` DS全域のトークンドリフト。**本レーンでは直さない**
    (DSトークン整合タスク3b670c9d-064c-8166に集約済み)
  - `[要判断]` Setaka判断が必要
  - `[粗]` 未解決の実装粗

集計: **[OK] 71 / [仕様] 6 / [DS案件] 6 / [要判断] 2 / [粗] 0 / 未実測1**

---

## 0. 横幅・外余白の扱い (全節に効く前提)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Content | PC外余白 | 80 | 64 (`--layout-grid-margin-desktop`) | [仕様] 注1 |
| Content | PC内容カラム幅 | 1280 | 1312 (`--layout-container-xl`) | [仕様] 注1 |
| Content | **SP外余白** | **16** | **16** (`--layout-grid-margin-mobile`) | **[OK]** |
| Content | **SP内容カラム幅** | **358** | **358** | **[OK]** |
| 全体 | 横スクロール | なし | `scrollWidth == innerWidth` (PC 1440/1440・SP 390/390) | [OK] |

注1: `design-kit.generated.json` の `conflicts[c-04]`「デザイン実測グリッドとコードの
layout.gridが食い違う (PC margin 80 vs 64)」と同一の既知差分。外余白はHeader /
Footer / 全ページの左端が同じ `layout.grid.margin.*` を解決する設計なので、この1
ページのために80を焼くと**全画面の左端が揃わなくなる**。C5-1カートと同じ判断で
トークン側に従った。影響は「内容カラムがPCのみ +32広い」だけで、内部の余白・
比率は下表のとおり一致する。**SPはFigmaと完全一致**。

---

## 1. ページ枠 / 節の縦リズム

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Event Content | PC上余白 | 48 | 48 (`md:pt-12`) | [OK] |
| Event Content | PC下余白 | 96 | 96 (`md:pb-24`) | [OK] |
| Event Content | SP上余白 | 16 | 16 (`pt-4`) | [OK] |
| Event Content | SP下余白 | 48 | 48 (`pb-12`) | [OK] |
| Breadcrumb | 高さ | 16 | 16 | [OK] |
| Breadcrumb→Header | PC溝 | 64 | 64 (`md:mb-16`) | [OK] |
| Breadcrumb→Header | SP溝 | 40 | 40 (`mb-10`) | [OK] |
| 節間 | PC gap (Header→Hero→Registration→Body) | 64 / 64 / 64 | **64 / 64 / 64** | [OK] |
| 節間 | SP gap (同) | 40 / 40 / 40 | **40 / 40 / 40** | [OK] |

Breadcrumbの既定下余白 (`mb-8`) はページ別にFigmaの溝が違うため、共有部品
`components/seo/breadcrumb.tsx` に `className` を**追加のみ**で受けられるようにして
ページ側から上書きした (既定値は不変 = 既存ページの表示は変わらない)。

---

## 2. Event Header (Figma PC 6657:13352 / SP 6663:8166)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Header | PC gap | 24 | 24 (`md:gap-6`) | [OK] |
| Header | SP gap | 20 | 20 (`gap-5`) | [OK] |
| Header | PC eyebrow→title / title→card | 24 / 24 | 24 / 24 | [OK] |
| Header | SP eyebrow→title / title→card | 20 / 20 | 20 / 20 | [OK] |
| eyebrow | 溝 | 12 | 12 (`gap-3`) | [OK] |
| eyebrow「Event」 | サイズ / 太さ | 14 / 500 | 14 / 500 | [OK] |
| eyebrow「Event」 | 色 | muted-foreground #585854 | #595854 | [OK] Δ1 (oklch→sRGB丸め) |
| Badge | 高さ | 20 | 22 | [OK] Δ2注2 |
| Badge | 左右padding | 10 | 8 | [OK] Δ2 |
| Badge | 文字 | 12 / 500 / #464748 | 12 / 500 / #464748 | [OK] |
| Badge | **角丸** | **8 (radius-lg)** | **rounded-full** | **[DS案件]** 注3 |
| Badge | **地色** | **secondary #d5d3c0** | **#ffc10d** | **[DS案件]** 注4 |
| 主見出し | PCサイズ | 36 | **44** | [仕様] 注5 |
| 主見出し | SPサイズ | 30 | **32** | [仕様] 注5 |
| 主見出し | 太さ | 500 | **300** | [仕様] 注5 |
| 主見出し | 色 | #464748 | #464748 | [OK] |
| 主見出し | 行高 | lh normal (1.2相当) | 1.2 (PC 52.8 / SP 38.4) | [OK] |

注2: DS Badgeは `py-0.5` + `text-xs`(lh 16) = 20pxに加えて透明1pxボーダーを持つ
ためboxは22。塗り面の見え方は20px相当。
注3: Figma R2はradius-lg 8、DS Badgeは `rounded-full`。**Badgeプリミティブ全体**
に効くため本レーンでは変えない。
注4: `secondary` トークンがFigma (#d5d3c0) と実装 (#ffc10d系) で食い違う。
**二重定義が根因でBoss側がDS整合タスクに集約済み**なので本表では記録のみ。
実装は正しいsemanticクラス (`bg-secondary` = DS Badgeのsecondary variant) を
使っているので、トークン是正だけで自動的にFigmaに一致する。
注5: 「ページ主見出しは44px display」の全体裁定に従い既存 `.page-title`
(SP 32 / PC 44 / weight 300 = displayトークン) を使った。太さ300はdisplay
トークン由来。ページ別に見出しスケールを増やさない方針。

---

## 3. 日時・開催地カード (Figma PC 6658:13324 / SP 6663:8172)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| card | PC padding | 24 | 24 (`md:p-6`) | [OK] |
| card | SP padding | 20 | 20 (`p-5`) | [OK] |
| card | gap | 16 | 16 (`gap-4`) | [OK] |
| card | 角丸 | 8 (radius-lg) | 8 | [OK] |
| card | 罫線幅 | 1 | 1 | [OK] |
| card | 地色 | card #f4f3ed | #f5f3ed | [OK] Δ1 |
| card | **罫線色** | **#888675** | **#858581** | **[DS案件]** 注6 |
| row | ラベル | 14 / 400 / muted | 14 / 400 / #595854 | [OK] |
| row | 値PC | 16 / 右寄せ | 16 / right | [OK] |
| row | 値SP | 14 / 右寄せ | 14 / right | [OK] |
| row | **値の色** | **#464748** | **#5d5e61** | **[DS案件]** 注6 |
| divider | 高さ / 幅 | 1 / 全幅 | 1 / PC 1262・SP 316 (= card内幅) | [OK] |
| divider | 色 | #888675 | #858581 | [DS案件] 注6 |
| row間 | 溝 | 16 | 16 | [OK] |
| 日時表記 | 書式 | `2026年8月10日（日）14:00–17:00` | `2026年8月10日(月) 14:00–17:00` | [仕様] 注7 |

注6: `border` (#888675 vs #858581) と本文 `foreground` (#464748 vs #5d5e61) の
トークンドリフト。DS全域に効くため記録のみ (DS整合タスクに集約済み)。
注7: 曜日・時刻レンジはFigmaと同構造。括弧が半角・日付と時刻の間に半角空白が
入るのはICU (`Intl.DateTimeFormat`) のロケール出力に従った結果。曜日が「日」でなく
「月」なのはFigmaのサンプル文字列側の誤りで、実装は実日付から曜日を導出している
(2026-08-10は月曜)。TZは `Asia/Tokyo` 固定 (VercelのUTC実行で日付がずれるのを
防ぐ。旧実装はTZ未指定でずれていた)。

---

## 4. Hero (Figma PC 6659:8002 / SP 6664:8160)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Hero | PC比率 | 1280x560 = 2.286 | 1312x574 = **2.286** | [OK] |
| Hero | SP比率 | 358x240 = 1.492 | 358x238.66 = **1.500** | [OK] Δ0.008 |
| Hero | 角丸 | なし | 0 | [OK] |
| Hero | 画像の収め方 | 枠を埋める | `object-fit: cover` | [OK] |
| Hero | 代替画像 | `/placeholder-hero-approach.jpg` | 同じ | [OK] |
| Hero | データ無し時 | (Figmaは画像前提) | 画像が無ければ**枠ごと非表示** | [仕様] |

---

## 5. Registration (Figma PC 6660:8002 / SP 6664:8163)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| card | PC padding / gap | 24 / 16 | 24 / 16 | [OK] |
| card | SP padding / gap | 20 / 12 | 20 / 12 | [OK] |
| card | 角丸 / 罫線幅 / 地色 | 8 / 1 / card | 8 / 1 / #f5f3ed | [OK] |
| CTA | 幅 | 全幅 | PC 1262 / SP 316 (= card内幅) | [OK] |
| CTA | 高さ | 43 | **43** (`component.button.height.cta`) | [OK] |
| CTA | 左右padding | 24 | 24 | [OK] |
| CTA | 角丸 | 8 (radius-lg) | 8 | [OK] |
| CTA | 文字 | 16 / 500 / 中央 | 16 / 500 / center | [OK] |
| CTA | 地色 | primary #464748 | #464748 | [OK] |
| CTA | **文字色** | **#f9f8f4** | **#ffffff** | **[DS案件]** 注8 |
| CTA | アイコン | なし | `svg` 0個 (旧lucideを撤去) | [OK] |
| 注記 | 文字 | 14 / 400 / muted | 14 / 400 / #595854 | [OK] |
| 注記 | 文言 | 「会員限定イベントです。ご参加にはログインが必要です。」 | messages `event.memberOnlyNotice` で同一 | [OK] |
| CTA→注記 | PC / SP溝 | 16 / 12 | 16 / 12 | [OK] |
| 6660:8006 | 12pxの行 | (デザイン注記) | **描画しない** | [仕様] 注9 |

注8: `primary-foreground` のドリフト (DS整合タスクに集約済み)。
注9: 「登録済みの場合は…MemberGateを表示」は実装者向けのデザイン注記であり
UI文言ではないため出さない。挙動としては実装済み (登録済みはoutline +
「登録をキャンセル」に反転 / 権限不足時はMemberGate)。

---

## 6. Body — 詳細・申し込み (Figma PC 6661:13490 / SP 6664:8168)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Body | gap | 16 | 16 | [OK] |
| 見出し | PCサイズ / 太さ | 24 / 500 | 24 / 500 | [OK] |
| 見出し | SPサイズ / 太さ | 20 / 500 | 20 / 500 | [OK] |
| 見出し | 色 | #464748 | #464748 | [OK] |
| 見出し→本文 | 溝 | 16 | 16 | [OK] |
| 本文 | サイズ | 16 | **16** | [OK] 注10 |
| 本文 | 行高 | lh normal (1.2相当) | 26 (1.625) | [仕様] 注11 |
| 本文→リンク | 溝 | 16 | 16 | [OK] 注10 |
| 詳細リンク | 高さ | 43 | 43 | [OK] |
| 詳細リンク | 左右padding | 20 | 20 | [OK] |
| 詳細リンク | 角丸 | 8 | 8 | [OK] |
| 詳細リンク | 罫線 | 1px #888675 | 1px #858581 | [OK] 注12 |
| 詳細リンク | 文字 | 16 / 500 | 16 / 500 | [OK] |
| 詳細リンク | 末尾グリフ | ↗ | ↗ (テキストのまま) | [OK] |
| 詳細リンク | PC幅 | 272 (内容幅) | 282.97 (内容幅) | [OK] 注13 |
| 詳細リンク | SP幅 | 358 (全幅) | 358 | [OK] |
| Body | データ無し時 | (Figmaは本文前提) | 本文も外部リンクも無ければ**枠ごと非表示** | [仕様] |

注10: 共有の `PortableText` は段落を `text-sm`(14) + `mb-4` で描く。Figmaは16pxな
ので**このページ枠の中だけ** `[&_p]:text-base` で上げ、最終段落の下マージンを
`[&>*:last-child]:mb-0` で落として節のgapを16に揃えた (共有部品を変えると
journal / farmers / playlistsに波及するため触らない)。
注11: 行高はFigmaのauto (1.2相当) ではなくC4-1で確定した本文の縦リズム
(DS側 `leading-relaxed`) を採用。日本語本文を1.2で組むと可読性が落ちるため。
注12: shadcnの `outline` variantは罫線幅だけ指定で色はcurrentColorになり、
未指定だと本文色 #5d5e61で描かれていた (実測で検出)。`border-border` を明示して
DSの罫線トークンに載せた。残る差 (#888675 vs #858581) はトークン側のドリフト。
注13: 文字列長由来の差 (文言・字送りがFigmaと同一でも実フォントで幅が変わる)。
padding / 高さ / 角丸は一致。

---

## 7. Sticky Register Bar (Figma SP 6664:13496 / SPのみ)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| bar | 高さ | 63 | 64 | [OK] Δ1 (border-top 1px込み) |
| bar | 幅 | 390 (全幅) | 390 | [OK] |
| bar | 左右 / 上下padding | 16 / 10 | 16 / 10 | [OK] |
| bar | 上罫線 | 1px | 1px | [OK] |
| bar | 地色 | card | #f5f3ed | [OK] |
| bar | 固定 | 画面下に追従 | `position: fixed` / `bottom: 0` | [OK] |
| 中のCTA | 高さ / 幅 | 43 / 358 | **43 / 358** | [OK] |
| bar | PCでの扱い | PCフレームに無い | PCは常時 `display: none` (`md:hidden`) | [OK] |
| bar | 表示条件 | (Figmaに状態指定なし) | ページ内の登録カードが視界にある間は出さない | [要判断] 注14 |
| ページ | 追従バー用spacer | なし | 敷かない (実寸を歪めない) | [OK] |

実測した挙動 (SP 390x844・絶対座標):
- 最上部 (登録カードが視界内) → **非表示**
- 登録カード通過後 / 最下部 → **表示** (h64 / w390 / btn 43x358)

注14: 「フッターが見えている間も隠す」案を実装して計測したが、登録カード下端
(abs 842) からフッター上端 (abs 1524) までの本文区間が **682pxしかなくviewport
844pxより短い**ため、**どのscroll位置でも両方が視界から外れず追従バーが一度も
出ない**ことを実測した (出せるscroll窓 = **-162px**)。Figmaがバーを描いている
以上、常用端末で機能が死ぬ方が忠実度として不利なので**登録カードのみを隠す条件**
に戻した。代償は最下部でフッター末尾に64px重なること (追従CTAの一般的挙動)。
→ 「まとめ確認事項」に選択肢として記載。

---

## 8. 導線・遷移

| 項目 | 期待 | 実測 | 判定 |
|---|---|---|---|
| 一覧 `/ja/events` | 200 | 200 | [OK] |
| 一覧カード → 詳細 | `/ja/events/<slug>` に遷移 | クリック → `landedUrl=/ja/events/seed-event-1` / `h1=新茶テイスティング会 2026` / 登録カード描画あり | [OK] |
| 一覧の見本カード | 詳細へリンク | 3件すべて `/ja/events/seed-event-{1,2,3}` | [OK] |
| 参加登録 | `/api/user/events` へPOST / DELETE | 既存APIを不改変で使用 (カード内と追従バーで状態共有) | [OK] |
| 詳細・申し込み | 外部URLを別タブで開く | `target=_blank` + `rel=noopener noreferrer` | [OK] |
| 会員限定ゲート | 権限不足時は本文を出さない | BodyをMemberGateと入れ替え (ヘッダー / Hero / 登録カードは表示) | [仕様] |
| **申込 / 申込完了画面への内部導線** | — | **未実測 (リンク先が存在しない)** | **[要判断]** 注15 |

注15: 委譲時の前提「イベント申込画面・申込完了画面 (実装済み) への導線を接続する」は
実測で成立しないことを確認した。
- `find app -type d | grep -Ei 'apply|complete'` → events配下 **0件**
- 全remote branchを `git ls-tree` 走査 → `events/[slug]/(apply|complete)` **0件**
- `grep -rl 'events/\[slug\]/apply|eventApply' products/` → **0件**
- Structure DBでも両行が **公開状態=企画中 / Figmaノードnull / Dev=Not started**
  (申込 https://app.notion.com/3b270c9d064c81339b9adea3d191fcbf /
   完了 https://app.notion.com/3b270c9d064c81a78888ded395614a37)

Figma R2確定版 (6657:7931) 側の導線も **(1) 参加登録API直結のCTA** と
**(2) `externalUrl` への外部リンク** の2本だけで、内部applyルートへのリンクは
設計に存在しない。存在しないルートへリンクすると404になるため**捏造せず**、
Figma正本どおり2本を実装した。

---

## 9. コンソール / 実行時の健全性

| 項目 | 結果 |
|---|---|
| console `error` | **0件** |
| console `warning` | **0件** |
| `pageerror` | **0件** |
| 横スクロール | なし (PC 1440/1440・SP 390/390) |
| ページstatus | PC 200 / SP 200 |
| `requestfailed` | 125件。内訳は **123件がNext.jsのRSC prefetch中断** (`?_rsc=…` + `ERR_ABORTED` / 計測ハーネスが高速に遷移するため) + **2件がSentryのテレメトリ送信** (外部ホスト・サンドボックス環境要因)。いずれもページの実行時エラーではない |

---

### 9-2. Vercel Previewでの再計測 (rebase後)

Preview: `https://elxea-web-jst4ec2xb-setaka1103s-projects.vercel.app`
(見本データを描くため **このdeploy限定**で `PREVIEW_SEED=1` を渡している。
プロジェクトの環境変数は変更していない)

| 項目 | 結果 |
|---|---|
| `/ja/events` | 200 |
| `/ja/events/seed-event-1` (PC / SP) | 200 / 200 |
| **Preview実測vs local prod実測** | **数値差分0件** (§1-7の全項目を突き合わせ) |
| console `error` / `warning` / `pageerror` | **0件** |
| `requestfailed` | 71件 = RSC prefetch中断69 + Sentry送信2 (localと同じ内訳) |
| 一覧 → 詳細 | Previewでもクリック遷移成立 (`h1=新茶テイスティング会 2026`) |
| 追従バー | SPで登録カード通過後に表示 / PCは `display:none` |

見本フラグを渡さない素のPreview (`elxea-web-33q345ce5-…`) では
`/ja/events/seed-event-1` が **not-foundを描く**ことも確認した。
`seedEventDetail()` がフラグ未設定で `null` を返す設計どおりで、
productionに見本が漏れないことの裏取りになっている。

---

## 10. DS側に追加したもの (既存画面への波及なし・実測根拠つき)

| 追加物 | Figma実測の出どころ | 既存画面への波及 (実測) |
|---|---|---|
| `component.button.height.cta = 2.6875rem (43px)` | 6660:8003 (PC登録CTA) / 6661:13493 (詳細リンク) / 6664:13497 (追従バー内) | `git diff dist/` = **+1行 / -0行** (新var追加のみ・既存varの値変化0) |
| Button `size="cta"` (h43 / px24 / rounded-lg / text-base) | 同上 | 既存size/variant **14キーすべてclass文字列の変化0件** (base commitとの比較) |
| `h2[data-slot="event-section-title"]` (SP 20 / PC 24 / weight 500) | 6661:13491 (PC) / 6664:8169 (SP) | 新規セレクタのみ。既存セレクタの変更0件。使用箇所は本レーンの1部品だけ |
| `Breadcrumb` に `className` (任意) | 6940:148 / 6940:154の溝 (PC 64 / SP 40) | 既定 `mb-8` は不変 = 既存8ページの表示は変わらない |

`__tests__/design-system/button-padding.test.ts` は **`cta` の網羅追加のみ**に絞った
(いったん足した既存size `service` の網羅はrevert。既存DSテストの書き換えは
DSトークン整合タスクへ申し送り)。

---

## 11. まとめ確認事項 (Setaka判断)

1. **申込 / 申込完了画面 (`/ja/events/[slug]/apply` `…/complete`) が存在しない** —
   委譲前提と実態が食い違う (注15の実測根拠)。Figmaノードも無くStructure DBでも
   「企画中」。R2の導線は参加登録APIと外部リンクの2本なので、**内部apply画面を
   作るならFigma凍結からの別タスク**が必要。今回は捏造せず未接続。
2. **SP追従バーの表示条件** — 現状は「ページ内の登録カードが見えている間だけ隠す」
   (= 最下部でフッター末尾に64px重なる / 追従CTAの一般的挙動)。代替案の
   「フッターが見えている間も隠す」は**この本文量では一度もバーが出ない**ことを実測
   (窓 -162px)。ページ下部に64pxのspacerを敷いて重なりを消す第3案もあるが、
   Figmaの実寸 (下余白48) が変わる。→ 現状維持で良いか。
3. (参考・再提起不要) Badge角丸 / secondary / border / foreground /
   primary-foregroundのFigma食い違いは **DSトークン整合タスク
   3b670c9d-064c-8166** に集約済み。本表では [DS案件] として記録のみ。
