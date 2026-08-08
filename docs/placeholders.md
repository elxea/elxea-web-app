# 仮当て値 (PLACEHOLDER) 差し替え台帳

- 対象プロダクト: roji (elxea)
- 仮値のSoT: `lib/placeholders.ts` (このファイルは読み手向けの台帳。値の正本はコード側)
- 作成: 2026-08-09 JST / elxea-developer

## 一言で

事業側の確定を待っている値を「明らかに仮」と分かる形で入れて先に進めるための台帳。
仮値が本番に出るのを機械的に止める仕組み (ビルドゲート + テスト) とセットで運用する。

## 結論・状態

未確定6件。すべて `lib/placeholders.ts` に集約済みで、`VERCEL_ENV=production` の
ビルドとテストは6件が残っている間は必ず失敗する。dev / Previewは失敗しない。

## Ask

**判断 (Tier 2 / Setaka)** — 下表の6件の実値。とくに法定表記4件は公開ブロッカー。
併せて「利用規約と特商法で所在地が違う」不一致 (Open items 1) の正を決めてほしい。

---

## どこを直せば公開できるか

```mermaid
flowchart LR
  A["lib/placeholders.ts<br/>仮値レジストリ"] --> B["value を実値に<br/>status を confirmed に"]
  B --> C{"未確定 0 件?"}
  C -- いいえ --> D["本番ビルド失敗<br/>validate:placeholders exit 1"]
  C -- はい --> E["本番ビルド通過<br/>公開可"]
  A --> F["定期便LP<br/>/ja/subscription"]
  A --> G["特商法ページ<br/>/ja/legal/tokushoho"]
```

## 差し替え一覧

| # | 対象 (id) | 出る場所 | 現在の仮値 | 差し替え担当 | 差し替え先の根拠 | 状態 |
|---|---|---|---|---|---|---|
| 1 | `subscription.firstDeliveryDate` | 定期便LP S2 DateRibbon (Figma 8071:126) | `9月10日（木）` | Setaka (事業判断) | Shopify定期便selling planの締日・発送曜日。確定後は定数ではなく計算式に置き換える | 未確定 |
| 2 | `subscription.monthlyPrice` | 定期便LP料金SpecBand (8071:462) / 申し込みブロック (8071:514) | `1,800円` | Setaka (価格決定) | Shopify定期便商品 (tag: `subscription`) のselling plan価格がSoT。確定後は本定数を消し `detail.sellingPlanGroups` の実価格を描画 | 未確定 |
| 3 | `tokushoho.operationsManager` | 特商法ページS1販売者 (7856:932) | `（公開前に差し替え）運営統括責任者 氏名未確定` | Setaka (法定表記) | 特定商取引法 第11条。法人登記上の代表者氏名 | 未確定 (公開ブロッカー) |
| 4 | `tokushoho.address` | 特商法ページS1販売者 (7856:932) | `（公開前に差し替え）所在地未確定` | Setaka (法定表記) | 特定商取引法 第11条。法人登記上の所在地 | 未確定 (公開ブロッカー) |
| 5 | `tokushoho.phone` | 特商法ページS1販売者 + S4窓口 (7857:39763) | `（公開前に差し替え）電話番号未確定` | Setaka (法定表記) | 特定商取引法 第11条。実際に受電できる番号のみ記載可 (受付時間と整合させる) | 未確定 (公開ブロッカー) |
| 6 | `tokushoho.email` | 特商法ページS1販売者 + S4窓口 | `hello@roji.jp` | Setaka (法定表記) | Figma凍結版の値をそのまま置いている。MX / 受信テストが通れば `confirmed` にする | 未確定 (受信確認待ち) |

法定表記 (#3-#5) は実在の住所・電話番号・個人名に見えない文字列にしてある。万一ガードを
すり抜けても読み手が一目で仮値と分かる状態を保つため、単体テストで次を機械的に強制している。

- `（公開前に差し替え）` を含むこと
- 郵便番号・電話番号・番地の形をした数字列 (`\d{3}-?\d{4}` / `\d{2,4}-\d{2,4}-\d{3,4}` / `\d+-\d+-\d+`) を含まないこと

## 差し替え手順 (実値が決まったとき)

1. `lib/placeholders.ts` の該当エントリの `value` を実値にする
2. 同エントリの `status` を `"confirmed"` にする
3. 本ファイルの該当行の「状態」を `差し替え済 (YYYY-MM-DD)` にする
4. `pnpm validate:placeholders` と `pnpm test` を通す
5. #1 / #2は定数のままにせず、Shopify実データ配線に置き換える (根拠列参照)

## 仮値が本番に出ない仕組み

| 層 | 実体 | production相当で | dev / Previewで |
|---|---|---|---|
| ビルドゲート | `scripts/check-placeholders.ts` (`pnpm validate:placeholders`、`pnpm build` の `next build` 前段) | exit 1でビルド中止 | 一覧をWARN表示してexit 0 |
| テスト | `__tests__/placeholders.test.ts` | 未解決0件を要求して失敗 | 判定ロジックのみ検証して通過 |

production判定はVercelが自動注入する `VERCEL_ENV=production` のみ。
`NODE_ENV` は見ない (`next build` はローカルでも `NODE_ENV=production` になり、
それで判定するとPreview用ビルドまで落ちてしまうため)。

手元で本番相当の挙動を確認するとき、およびCIで強制するときは
`ROJI_PLACEHOLDER_GUARD=error` を渡す (`=off` で無効化)。

```bash
# 仮値が残っている状態で本番相当ビルドが落ちることの確認
VERCEL_ENV=production pnpm validate:placeholders   # exit 1
VERCEL_ENV=production pnpm test                    # fail
```

## Open items (仮値ではなく、要判断の不一致)

1. **所在地の不一致** — 利用規約S4 (`app/[locale]/legal/terms/page.tsx`) は所在地に実値らしい
   文字列を載せているが、特商法ページは仮値。どちらを正とするか未決。本タスクでは
   利用規約側を変更していない (未検証の値を「確定」と扱わないため)。決まり次第、
   両ページが同じSoTを参照する形に寄せる。
2. **お届け月の表記** — 定期便LPの `nextMonthChip` / `nextMonthBody` / `month*Value` は
   月次で入れ替わる編集コンテンツで、今回の仮値集約の対象外。運用時に誰がいつ更新するか
   (Sanityへ移すか、Shopify metafieldにするか) が未決。
3. **受付時間** — 特商法ページS4の `平日 11:00–17:00（土日祝を除く）` は仮値扱いにして
   いないが、電話番号 (#5) の確定と同時に実運用と合っているか確認が必要。

## 参照元

- `lib/placeholders.ts` (仮値のSoT)
- `scripts/check-placeholders.ts` / `__tests__/placeholders.test.ts` (ガード)
- `app/[locale]/subscription/page.tsx` / `app/[locale]/legal/tokushoho/page.tsx` (参照側)
- `messages/ja.json` / `messages/en.json` の `subscriptionR2` (差し込み口 `{firstDelivery}` / `{monthlyPrice}`)
- 特定商取引法 第11条 (通信販売の広告表示義務)
