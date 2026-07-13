# Figma snapshots + change-manifest (経済化施策②)

Decision Log: `39c70c9d064c81079145f69744e7b8f5` (品質最優先・品質中立の施策のみ採用)

## これは何か / 何ではないか

`figma-snapshot` (`snapshot:figma`) と `figma-change-manifest` (`diff:figma`) は、
Figma の Proposals ページ配下 `@/<route>` セクションを **決定論的に正規化した
baseline** を repo に置き、live との **決定論 diff** で「どのページ / どの node が
変わったか」を機械可読に出力するツールです。デザイン反映セッションが毎回 Figma を
LLM で全実測する必要をなくし、**変更フレームだけ**を見れば済むようにします
(O(変更フレーム))。

**重要 — これは検証の置換ではありません。** change-manifest は
**CHANGE-CANDIDATE NARROWER (変更候補の絞り込み)** に過ぎません。次の検証義務は
**一切変わりません**:

- fidelity gate (`EVIDENCE: fidelity-table:<path>`) は反映した全変更に適用される。
- DS-instance / `ds-instance-report` の義務も不変。
- **「manifest に無い = 検証済み・変更なし」と読み替えてはいけません。**

## ファイル

| ファイル | 役割 | git |
|---|---|---|
| `proposals.snapshot.json` | baseline (前回取得の正規化 snapshot)。diff の基準。 | commit する |
| `change-manifest.json` | `diff:figma` の出力 (added/removed/modified)。派生物。 | commit 任意 (派生) |

## 使い方

```bash
# 1) baseline を取得 (Figma REST GET のみ / read-only)。commit すると次回 diff の基準。
pnpm snapshot:figma

# 2) live を再取得して baseline と diff → change-manifest.json
pnpm diff:figma
```

`diff:figma` は baseline を **上書きしません** (冪等)。変更が無ければ再実行しても
diff=0 です。baseline を進めたいときは `snapshot:figma` を再実行して commit し直します。

必要な環境変数: `.env.local` の `FIGMA_PERSONAL_ACCESS_TOKEN` (read-only GET)。
既定 file key = elxea DS 正本 `AWLnI0XF07e8rScuxPYPc7`。`--file-key` / `FIGMA_FILE_KEY`
で上書き可。

**CI には配線していません。** トークン不在の CI で必ず fail するため、ローカル /
反映セッション専用のツールです。

## 品質保護 (silent drop を潰す設計 / circl-qa 条件 C4)

決定論 diff は「snapshot が捕捉したもの」しか検知できません。捕捉漏れ =
デザイナーの変更がコードにもゲートにも届かない「見落とし」になります。以下で塞いでいます:

1. **resolved 値を保存** — binding 名だけでなく解決済みの color/number を保存。
   variable の**値のみ**変更 (C4-i) も modified fill として現れる。
2. **INSTANCE 内部も走査** — resolved instance subtree を保存。main コンポーネント
   内部の変更が instance に波及 (C4-ii) すると per-instance の modified になる。
3. **fail-loud** — nodes API が section の document を返さない (部分取得) → `exit 1`。
   baseline が壊れ JSON / 不在 → `exit 1`。穴を黙って snapshot しない。
4. **除外の明示計上** — Proposals 直下で `@/<route>` でない section は
   件数 + id/name + 理由を manifest に出力 (silent truncation 禁止)。
5. **completeness シグナル** — file の `lastModified` が baseline 以降に進んでいるのに
   diff が空なら「捕捉外の変更の疑い」を警告。既定は警告 (別ページ編集でも
   lastModified は進むため hard-fail は誤検知源)。`--strict-completeness` で `exit 1`。

## 正規化に含める属性

id / name / type / route と、`props`: 座標-サイズ (box)・opacity(≠1)・visible(false)・
componentId・fills・strokes(+strokeWeight)・effects・cornerRadius・auto-layout
(layoutMode/itemSpacing/padding/align)・TEXT の characters と textStyle。数値は丸めて
sub-pixel の float ノイズを消し、キーはソートして安定出力します (`stableStringify`)。
