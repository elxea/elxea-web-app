/**
 * People 詳細の骨格部品 (C12-1)。
 *
 * ## この層が存在する理由
 * Figma の正本は「【採用: 作り手の共通テンプレ】 People 詳細」
 * (section `7822:37212` / PC `7822:37213` / SP `7823:37542`、page 7567:5
 * Journal / Layouts)。**People 詳細テンプレが上位で、農家詳細はその派生**という
 * 関係が Figma 側の命名で明示されている:
 *
 * - 農家詳細の確定版 section 名 = `【R2: 確定版】 農家詳細 (People 詳細テンプレ統合)`
 * - その旧版 = `【要修正: People 詳細へ統合】 農家詳細` (統合の向きが「農家 → People」)
 * - プレイリスト詳細の確定版も `People 詳細テンプレ整合` を名乗る (`8089:4518`)
 *
 * つまり People 詳細テンプレは複数画面が参照する共通テンプレ (SoT) であり、
 * その **R2 世代の実測値は農家詳細【R2: 確定版】(`8079:3748` / `8079:3966`) に
 * 入っている** (People 詳細テンプレ自身は R1 で【採用】凍結)。
 *
 * その R2 実測値は `components/farmers/farmer-detail.tsx` が C4-4a で既に
 * 体現している。よって People 詳細は**その部品をそのまま使う**のが Figma に最も
 * 忠実で、かつ再利用の要件にも合う。本ファイルは実装を複製せず、People 層での
 * 正しい名前を与える薄い再輸出に留める。
 *
 * ## なぜ farmer-detail.tsx を People 用に改名しないか
 * farmer-detail.tsx の実装注記が「両レーンが main に入った後に『People 詳細
 * テンプレ共通骨格』として 1 本に寄せるのが正で、それは別タスクで行う」と
 * 宣言している。C12-1 の専有範囲は People 詳細・コレクション詳細の 2 画面と
 * その専用部品であり、農家詳細・プレイリスト詳細の実装を動かす権限は無い
 * (並行レーンが同じファイル群を触っている)。改名は 3 画面を同時に動かすので
 * この層で名前だけ整え、統合そのものは後続タスクに残す。
 *
 * ## People 詳細と農家詳細の節構成の差
 * 農家詳細 = People 詳細テンプレ + 茶園 2 節 (`FIELD DATA` `8079:3937` /
 * `THE FIELD` `8079:3947`)。People 詳細はこの 2 節を持たない。それ以外
 * (PersonHead / Quote / THE WORK / INTERVIEW / PROFILE / この人の仕事 /
 * ほかの人をたずねる) は写真キャプション・Stats のラベル (`YEARS` / `STORIES`)・
 * `AuthorByline` インスタンスまで一致する。
 */

export {
  FarmerHead as PersonHead,
  FarmerQuote as PersonQuote,
  FarmerSection as PersonSection,
  FarmerSectionHead as PersonSectionHead,
  FarmerSectionBody as PersonSectionBody,
  FarmerDataBand as PersonDataBand,
  FarmerCardGrid as PersonCardGrid,
  ProcessGrid,
  InterviewList,
  farmerBandClass as personBandClass,
} from "@/components/farmers/farmer-detail";

export type {
  FarmerStat as PersonStat,
  FarmerHeadProps as PersonHeadProps,
  FarmerCardItem as PersonCardItem,
  ProcessItem,
  InterviewItem,
} from "@/components/farmers/farmer-detail";
