# C17-1忠実度対比表 — 著者ページのPeople統合 / カートSPタップ域 / 完了マーク対比 / 利用規約節見出し

本レーンは**新しい画面を作らない**。既存レーンが確認事項として残した宿題4件を、
実測で閉じるための対比表である。したがって節の構成は「画面ごと」ではなく
「閉じた宿題ごと」に並べる。

- 対象と出どころ (どのレーンの宿題か)

| 項目 | 出どころの確認事項 | 内容 |
|---|---|---|
| E3 / E4 | `c14-1-fidelity.md` 確認事項2 | `/journal/author/[slug]` を `/people/[slug]` へ寄せて1本にする |
| Q2 | `c5-1-fidelity.md` (SPのステッパ) | 数量ステッパのタップ域が24しかない |
| Q3 | `c6-1-fidelity.md` §7 | 完了マークの✓が白抜きで非テキスト対比3:1に届かない |
| Q4 | `c10-1-fidelity.md` 確認事項12 | 利用規約のS4節見出しが素の `<h3>` のまま (条見出し24px化で逆転が再発する) |

- 実装値の取得方法: 自前 **production build** (`PREVIEW_SEED=1` / `pnpm build` →
  `SITE_PASSWORD= pnpm exec next start -p 3170`) をChromiumで開き、
  `getBoundingClientRect` / `getComputedStyle` で実測。
  **色はスクリーンショットをdata URLで戻してcanvasに描き `getImageData` で取得**
  (computed styleの合成ではなく実際に描かれた色)。**当たり判定は
  `document.elementFromPoint` を1px刻みで走査した外形**で、クラス名の見かけではない。
  308は `curl -sI` と `fetch(redirect:"manual")` の2経路で実測。
- 計測ビューポート: PC 1440x1000 / SP 375x1000 (`deviceScaleFactor` 1、
  PNGバイト比較のみ2)
- ハーネス: `scripts/scratch/measure-c17.mjs` (A-E) / `measure-c17b.mjs` (追加検証) /
  `measure-c17c.mjs` (ルートスイープ) — `scripts/scratch/` はgitignore対象の使い捨て
- 出力: `/tmp/c17-work/.c17-measured.json` / `.c17-measured-b.json` / `.c17-sweep.json`
- 計測日時: 2026-08-10 00:0x JST (`origin/feat/c1-ds-foundation` @ `83ef89e` 起点 /
  計測は `4521313`)
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 (出典あり) / `[要判断]` Setaka判断が要る

---

## 1. E3 / E4 — 著者ページをPeople詳細へ308恒久統合

### 1-1. なぜ転送で寄せられるのか (データ側の根拠)

`/people/[slug]` の `PERSON_BY_SLUG_QUERY` は
`*[_type == "author" && slug.current == $slug]` を引く。旧著者ページの
`AUTHOR_BY_SLUG_QUERY` と **同じ `author` ドキュメント・同じslug空間**なので、
旧URLで200だったslugは新URLでも必ず200になる (取りこぼしが構造上ありえない)。
`sanity/schemas/` に `person.ts` は無く、People詳細は最初から `author` を読んでいる。

### 1-2. 転送の実測 (`curl -sI` / `fetch(redirect:"manual")`)

| 旧URL | 期待 | 実測status | 実測Location | 判定 |
|---|---|---|---|---|
| `/ja/journal/author/masayuki-kubo` | 308 | **308** | `/ja/people/masayuki-kubo` | [OK] |
| `/journal/author/masayuki-kubo` (locale無し) | 308 | **308** | `/ja/people/masayuki-kubo` | [OK] |
| `/en/journal/author/masayuki-kubo` | 301 → 308 | **301** | `/ja/journal/author/masayuki-kubo` | [OK] 注1 |
| 追従後の最終到達 | 200 | **200** / `…/ja/people/masayuki-kubo` (1 redirect) | — | [OK] |
| `/ja/people/masayuki-kubo` (転送先そのもの) | 200 | **200** | — | [OK] |
| `/ja/journal/author/no-such-person-xyz` | 308 → 404 | **308** → 追従後 **404** | `/ja/people/no-such-person-xyz` | [OK] 注2 |

注1: `/en/*` はmiddlewareが先に301で `/ja/*` へ送るため、`/en` 起点だけ
301 → 308の2ホップになる。`redirects()` にenを足してもmiddlewareのほうが先に
効くので減らせない。membership (C13-1) / contact/business (C10-1) と同じ挙動。

注2: 存在しないslugも308で転送されたうえで転送先が404になる。
「旧URLが黙って200を返す」抜け道が無いことの確認 (`notFound()` は転送先で判定)。

### 1-3. 内部リンクの付け替え (3箇所)

| # | ファイル | 修正前 | 修正後 | 判定 |
|---|---|---|---|---|
| 1 | `app/[locale]/journal/[slug]/page.tsx` | `/journal/author/${author.slug.current}` | `/people/${author.slug.current}` | [OK] |
| 2 | `app/[locale]/elxea-journal/[slug]/page.tsx` | `/journal/author/${journal.author.slug.current}` | `/people/${…}` | [OK] |
| 3 | `components/journal/author-profile.tsx` | `/journal/author/${author.slug.current}` | `/people/${author.slug.current}` | [OK] |

転送があっても内部リンクを直すのは、**自分のサイト内で1ホップ余計に踏ませない**ため。

実画面での確認 (記事詳細 `/ja/journal/tea-time-as-luxury-slow-life-practice`):
著者リンクの `href` は `/ja/people/asako-sato` x2 (バイライン + 記事末尾プロフィール)。
`/ja/journal` `/ja/elxea-journal` `/ja/people/[slug]` `/ja/cart` `/ja/legal/terms` の
DOMを走査して `/journal/author/` を含む `href` は **0件**。

### 1-4. 撤去したもの

| 対象 | 行数 | 理由 |
|---|---|---|
| `app/[locale]/journal/author/[slug]/page.tsx` | 253 | 画面ごと廃止 (Figma section `7805:1952`「【廃止: People詳細へ統合】」) |
| `components/journal/author-detail.tsx` | 234 | 上の画面専用の部品。他に呼び出し無し (= E4も同時に閉じる) |
| `messages/ja.json` / `en.json` の `journal.authorArticles` / `journal.authorLinkLabel` | 各2行 | 上の画面でしか使っていない文言。ja/en対で落として鍵の対応は保つ |

build後のroute manifestに `/[locale]/journal/author/[slug]` は**出ない**
(`/[locale]/people/[slug]` のみ)。

### 1-5. sitemap / design-map / design-kit

| 対象 | 期待 | 実測 | 判定 |
|---|---|---|---|
| `app/sitemap.ts` | `author` ドキュメントを `/[locale]/people/[slug]` として出す | 既にその実装 (`BASE_URL}/${locale}/people/${author.slug}`)。**変更なしで正** | [OK] |
| `scripts/design-system/design-map.json` | 撤去した部品を指すエントリが無いこと | `author-detail.tsx` を指すエントリは**元から0件**。`author-profile.tsx` (42) / `author-byline.tsx` (68) は現存部品なので据え置き。`validate:design-map` 0 error / 192 entries | [OK] |
| `design-kit.manual.json` / `.generated.json` の `routes_covered` | — | `/ja/journal/author/[slug]` の記載は残す。ここは「Figmaが過去にどの画面を持っていたか」の被覆記録で、廃止済み画面 (`/ja/membership` / `/ja/contact/business`) も同様に残っている先例に合わせた | [仕様] |
| `app/globals.css` の `article-card-title` コメント | 実在する画面だけを指すこと | 「People詳細 / 著者ページ の『この人の記事』」→ 「People詳細の『この人の記事』」に修文 (コメントのみ・体裁は不変) | [OK] |

---

## 2. Q2 — カートSPの数量ステッパのタップ域44

見た目 (視覚サイズ・罫線・角丸・塗り) はFigma `Stepper / Qty` `6906:335` の24x24のまま、
**擬似要素だけを44x44に広げて当たり判定にした**。C8-1の「静かな導線24 → 44」
(c8-1注22) と同じ考え方だが、あちらは枠の見た目が無い文字リンクなので `min-h-11` で
枠ごと広げられた。ここは枠に罫線と塗りがあるため、枠を広げるとFigmaと違う見た目になる。

| 対象 | 項目 | Figma実測 | 実測 (SP 375) | 実測 (PC 1440) | 判定 |
|---|---|---|---|---|---|
| minus / plus | 視覚サイズ | 24 x 24 | **24.00 x 24.00** | **24.00 x 24.00** | [OK] 不変 |
| minus | タップ域 (elementFromPoint走査) | — (WCAG 2.5.5 = 44) | **44 x 45** | 24 x 25 | [OK] 注3 |
| plus | タップ域 (同) | — (同) | **44 x 45** | 24 x 25 | [OK] 注3 |
| minus / plus | `::before` の寸法 | — | 44px x 44px / `display:block` | 44px x 44px / **`display:none`** | [OK] |
| ステッパ全体 | 幅x高さ | 88 x 24 | **88.00 x 24.00** | **88.00 x 24.00** | [OK] 不変 |
| 数値 | `pointer-events` | — | `none` | `none` | [OK] 注4 |
| 数値 | `aria-label` | — | `数量` (不変) | `数量` | [OK] |
| 「削除」 | 中央が押せるか | — | **true** (奪っていない) | **true** | [OK] |
| ページ | `document.scrollWidth` | — | **375** (横あふれ0) | **1440** | [OK] |

注3: 高さの実測が45なのは走査が両端を含む数え方 (`b - t + 1`) で、要素の縦中央が
サブピクセル位置にあるため1px多く出る。`::before` の解決値は44pxで、44を下回る
方向のズレは無い。

注4: 44の枠は水平方向に ±10はみ出すので、数値 (`w-8` = 32) の両端6pxずつが枠と重なる。
`<span>` が上に乗ると6pxぶんクリックを奪うため `pointer-events-none` で素通しした
(読み上げは `aria-label` に残るのでa11yは不変)。実測: 数値の左端 = minusの当たり判定 /
中央 = どちらでもない / 右端 = plusの当たり判定。

### 2-1. 「視覚枠の外側でも押せる」ことの実動確認

視覚枠 (24x24) の**外側** 6pxを `mouse.click` して、どのボタンのhandlerに届いたかを
capture phaseのlistenerで記録した (SP 375)。

| 突いた位置 | 届いた先 | 判定 |
|---|---|---|
| plusの右外 +6 | **plus** | [OK] |
| plusの上外 -6 | **plus** | [OK] |
| plusの下外 +6 | **plus** | [OK] |
| minusの左外 -6 | **minus** | [OK] |
| minusの上外 -6 | **minus** | [OK] |

数量の表示が変わらないのは見本カート (`PREVIEW_SEED=1` の `seedCart()`) がShopifyへ
書き込まないためで (c5-1「計測データについて」)、**handlerには届いている**。
無操作時のカートページのconsole errorはPC / SPともに0件。

---

## 3. Q3 — ログイン完了の完了マークの非テキストコントラスト

✓ は「連携が完了した」という状態を伝える唯一の図なので、WCAG 1.4.11の
非テキストコントラスト **3:1** が要る (装飾例外に当たらない)。円の色・寸法・角丸は
Figma `Check Circle` `6750:10384` のまま、**記号色だけ** `primary-foreground` から
`success-foreground` に変えた。どちらもDSが対で持つ意味色で、生カラーは書いていない。

同一ビルド上で記号色を旧値に描き替えてbefore / afterを同条件で測った
(色はすべてscreenshot → canvas `getImageData`)。

| 対象 | 項目 | 修正前 (実測) | 修正後 (実測) | 要件 | 判定 |
|---|---|---|---|---|---|
| Check Circle | 面色 | `#9ecbc0` (`success`) | `#9ecbc0` (不変) | Figma `#9ecbc0` | [OK] |
| Check Circle | 記号色 | `#f9f8f4` (`primary-foreground`) | **`#464748`** (`success-foreground`) | — | [仕様] 注5 |
| ✓ / 円 | 非テキスト対比 | **1.681:1** | **5.213:1** | 3:1 (WCAG 1.4.11) | [OK] |
| Check Circle | 寸法 / 角丸 | 64 x 64 / full | **64.00 x 64.00** / full | Figma 64 / full | [OK] 不変 |
| ✓ | 図形サイズ / 太さ | 32 x 32 / strokeWidth 3 | **32.00 x 32.00** / 3 | — | [OK] 不変 |
| ページ | console error | — | **0件** | 0 | [OK] |

注5: Figmaの指定は `#f9f8f4` (白抜き) で、**この行はFigmaから意図的に外した**。
C6-1の注8で成功バナーの文字色を同じ理由 (`success` の薄色ではAAに届かない) で
`success-foreground` に寄せた先例があり、同じ対の色を使うことで整合させた。
Figma側を直すなら「円を濃くする」か「✓を濃くする」の二択で、後者を採ったことになる。

補足 (数値の出どころ): 裁定文の「1.786:1」は記号色を**純白 `#ffffff`** として計算した値。
`primary-foreground` はDSトークン整合 (2026-08-09) で `#f9f8f4` に直っているため、
実際の修正前の値は **1.681:1** だった。どちらも3:1に届かない点は同じ。

---

## 4. Q4 — 利用規約S4節見出しへの `legal-section-title` 先行適用

### 4-1. なぜ「今」当てるのか

利用規約の条見出し (`第N条…`) は `<h2>` に
`[font:var(--typography-style-h4)]` を付けているが、**このutilityは効いていない**。
`app/globals.css` の `h2 { font: var(--typography-style-h2) }` がunlayeredで、
Tailwindの `@layer utilities` より強いためである (globals.css自身が
「unlayeredなのでTailwind utilitiesでは当てられず」と警告している箇所)。
結果、条見出しは**意図せず24px** で描かれている (実測24px / c10-1項目7の既知issue)。

いま条24 > 節20なので逆転は表に出ていない。項目7を直して条が16pxになった瞬間に
「タグは下位 (h3) なのに文字が大きい (20 > 16)」という**プライバシーで是正済みの逆転が
利用規約側で再発する**。よって体裁を変えずに要素とスロットだけ先に揃えた。

### 4-2. 「見た目が1pxも変わっていない」ことの実測

同じ親・同じ文言で**素の `<h3>` を実際に描いて**並べ、全項目を突き合わせた。

| 項目 | 素の `<h3>` (修正前の姿) | `h2[data-slot="legal-section-title"]` (修正後) | 判定 |
|---|---|---|---|
| font-size | 20px | 20px | [OK] |
| line-height | 26px | 26px | [OK] |
| letter-spacing | 0.4px | 0.4px | [OK] |
| font-weight | 400 | 400 | [OK] |
| font-family | aktiv-grotesk-extended, dnp-shuei-gothic-gin-std, sans-serif | 同 | [OK] |
| color | `lab(30.0515 -0.244707 -0.706011)` (= `#464748`) | 同 | [OK] |
| margin (上/下) | 0px / 0px | 0px / 0px | [OK] |
| 外形 (PC 1440) | 1312 x 26 | **1312 x 26** | [OK] |
| 外形 (SP 375) | 343 x 26 | **343 x 26** | [OK] |

さらに、見出しの周囲をクリップして**両方の状態を実際に撮りPNGのバイト列を比較**した
(`deviceScaleFactor` 2)。

| ビューポート | クリップ | `h2[data-slot]` のsha256 | 素の `h3` のsha256 | 判定 |
|---|---|---|---|---|
| PC 1440 | 1320 x 34 | `aff9d509…f2bf6d` | `aff9d509…f2bf6d` | **バイト同一** |
| SP 375 | 351 x 34 | `9e6e4cc4…6bc5adb` | `9e6e4cc4…6bc5adb` | **バイト同一** |

### 4-3. 見出し構造 (利用規約 / プライバシー)

| 項目 | 利用規約 | プライバシー | 判定 |
|---|---|---|---|
| `h1` の数 | 1 | 1 | [OK] |
| 見出しレベルの逆転 | **0件** | **0件** | [OK] |
| 素の `<h3>` (スロット無し・class無し) の残数 | **0** | **0** | [OK] |
| 節見出しの要素 / サイズ | `h2` / 20px | `h2` / 20px | [OK] 揃った |
| 条見出しの要素 / サイズ | `h2` / 24px (項目7の既知issue) | `h2` / 16px | [要判断] 注6 |

注6: 条見出しのサイズが2ページで違う (24 / 16) のはc10-1項目7の未決事項で、
**本レーンの範囲外**。本レーンは「項目7を直したときに逆転が再発しない下地」を作っただけで、
サイズ自体は1pxも動かしていない。

---

## 5. ゲート結果

| # | ゲート | 結果 |
|---|---|---|
| 1 | TypeScript `pnpm typecheck` | [OK] エラー0 |
| 2 | ESLint `pnpm lint` (`--max-warnings 0`) | [OK] 警告0 |
| 3 | Unit test `pnpm test` | [OK] 105 files / 731 passed / 1 skipped |
| 4 | production build `pnpm build` (`PREVIEW_SEED=1`) | [OK] exit 0 / route manifestから旧著者ルートが消えている |
| 5 | DS検証 `validate:tokens` / `validate:design-map` / `validate:placeholders` | [OK] 0 error (tokens 20 warn / design-map 192 entries / placeholder 8は既知の未確定8件) |
| 6 | 実画面スイープ10ルートx PC/SP = **20計測** | [OK] 全200 / console error 0 / 横あふれ0 / `h1` 数1 / レベル飛び0 / 逆転0 / 旧URLリンク0 |
| 7 | 忠実度実測 | [OK] 本表1-4節。308はcurl実測 / タップ域はelementFromPoint走査 / 色はcanvas / 見た目同値はPNGバイト比較 |
| 8 | 他レーン非侵襲 | [OK] P0が持つ `.github/workflows/ci.yml` / `vitest.config.*` / `lib/preview-seed.ts` は**未編集**。`app/globals.css` はコメント1行の修文のみ (規則は追加も削除もしていない) |

---

## 6. 変更ファイル

| ファイル | 変更 |
|---|---|
| `next.config.ts` | 旧著者URL 2本を308で `/ja/people/[slug]` へ (末尾に追記) |
| `app/[locale]/journal/author/[slug]/page.tsx` | **削除** (308へ移行) |
| `components/journal/author-detail.tsx` | **削除** (上の画面専用部品 = E4) |
| `app/[locale]/journal/[slug]/page.tsx` | 著者リンクを `/people/[slug]` へ |
| `app/[locale]/elxea-journal/[slug]/page.tsx` | 同 |
| `components/journal/author-profile.tsx` | 同 |
| `messages/ja.json` / `messages/en.json` | 孤児化した `journal.authorArticles` / `authorLinkLabel` を削除 |
| `components/ui/quantity-stepper.tsx` | SPのタップ域を擬似要素で44に (見た目24は不変) / 数値を `pointer-events-none` |
| `components/auth/auth-card.tsx` | 完了マークの記号色を `success-foreground` に |
| `app/[locale]/legal/terms/page.tsx` | S4節見出しを `h2[data-slot="legal-section-title"]` に |
| `app/globals.css` | `article-card-title` のコメントから廃止画面の記載を落とす (コメントのみ) |
| `docs/fidelity/c17-1-fidelity.md` | 本表 (新規) |
| `docs/fidelity/c5-1` / `c6-1` / `c10-1` / `c14-1` | 該当行・確認事項に本レーンでの決着を追記 |

---

## 7. 確認事項 (Setaka判断)

| # | 事項 | 推奨 | 影響範囲 |
|---|---|---|---|
| 1 | **完了マークの✓をFigmaの白抜きから外した** (`#f9f8f4` → `#464748`)。実測1.681:1 → 5.213:1でWCAG 1.4.11の3:1を満たす。Figmaを直す場合「円を濃くする」か「✓を濃くする」の二択で、実装は後者を採った | 実装のまま (a11y優先) + Figma側も✓濃色で凍結し直す | ログイン完了のみ |
| 2 | **カートのステッパは見た目24 / タップ域44という二重構造**にした。Figmaに「タップ域」の枠が無いので、Figma側にも44の当たり判定枠を明示するかはdesign判断 | 実装のまま。Figmaに注記枠を足すかはdesigner判断 | カートのみ (他に `QuantityStepper` の利用箇所なし) |
| 3 | **利用規約の条見出しが24pxなのは意図せぬ描画**(c10-1項目7)。`[font:var(…)]` のutilityがunlayeredな `h2 {font:…}` に負けている。本レーンは節見出しの下地だけ作り、条のサイズは動かしていない。**条をFigmaどおり16pxにするか (プライバシーと同じ `legal-clause-title` に寄せる)** の判断が要る | `legal-clause-title` スロットに寄せて2ページを揃える (別タスク) | 利用規約のみ |
| 4 | **`/en` 起点の旧著者URLは301 → 308の2ホップ**になる (middlewareが先に効くため減らせない)。既存のmembership / contact/businessと同じ挙動 | 現状のまま (先例と一致) | 旧URLの被リンク |
| 5 | **`design-kit.*.json` の `routes_covered` に廃止画面が残る**。ここはFigmaの被覆記録で、`/ja/membership` `/ja/contact/business` も同様に残っている。「廃止画面を落とす」運用に変えるなら3画面まとめて別タスク | 現状のまま (先例と一致) | design-kitの記録のみ |
| 6 | **`lib/preview-seed.ts` の `withSeedAuthorDetail()` が未使用になった** (呼び出し元の著者ページを撤去したため)。同ファイルはP0レーンが編集中なので本レーンでは触っていない | P0の作業完了後に削除 (別タスクor P0に申し送り) | プレビュー見本のみ (productionは無効) |
