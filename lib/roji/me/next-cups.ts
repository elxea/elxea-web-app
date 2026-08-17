/**
 * 「この先の一杯」— 自分を知ったあとの出口。
 *
 * ## なぜページの末尾に置くのか
 *
 * 自分を深く知るページは、そこで閉じると日記になる。roji では
 * **自分の輪郭がそのまま次の一杯の手がかりになる**ところまでが一続きなので、
 * 4 枚の図を見たあとに「まだ飲んでいないが、いまの自分の近くにある茶」を
 * 静かに置いて回遊を閉じる。推薦ではなく **近さの提示** として書く
 * (「あなたへのおすすめ」という言い方は roji のトーンに合わない)。
 *
 * ## 算法 (差し替え前提のダミー)
 *
 * 直近の一杯ほど重く見た重心を味の座標に取り、**まだ一度も飲んでいない銘柄**を
 * その重心からの距離で並べる。実データでは購買履歴・在庫・季節が入るので、
 * ここは「重心の取り方」だけを残して中身を差し替える。
 *
 * ## 候補は必ず同じカテゴリーの中から取る
 *
 * 味の座標 (甘み⇄渋み / 軽やか⇄濃厚) は **同じカテゴリーの中でだけ比較できる**
 * 物差しで、緑茶の重心から青茶までの距離には意味が無い。roji の確定ルール
 * (1 枚の図・1 つの比較に載るのは同じカテゴリーだけ) をここでも守り、
 * `LOG_CATEGORY` と同じカテゴリーの銘柄だけを候補にする。
 *
 * 差し替え時に守る契約:
 * - 返すのは 3 件まで。多いと選べず、選べないと出口にならない
 * - **点数・順位・一致度などの数値を返さない** (roji 原則)。近さは言葉に翻訳する
 * - すでに飲んだ銘柄は返さない (「知っているものを勧められた」が最も冷める)
 * - **カテゴリーを跨いだ候補を返さない**
 */

import { CATALOG_TEAS, type CatalogTea } from "@/lib/roji/me/tea-catalog";
import { LOG_CATEGORY, TEA_CUPS } from "@/lib/roji/me/tea-log";

/** 重心を取るときに見る直近の杯数。全部を平均すると入口のころの味に引き戻される。 */
const RECENT_WINDOW = 12;

/** いまの自分の味の重心。直近ほど重い。 */
function recentCentre(): { x: number; y: number } {
  const recent = TEA_CUPS.slice(-RECENT_WINDOW);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  recent.forEach((cup, i) => {
    // 直近ほど重い単純な線形の重み。指数にすると最後の一杯だけで決まってしまう。
    const w = 1 + i / recent.length;
    sx += cup.x * w;
    sy += cup.y * w;
    sw += w;
  });
  return { x: sx / sw, y: sy / sw };
}

export interface NextCup {
  tea: CatalogTea;
  /** 近さを言葉にしたもの。数値は出さない。 */
  nearness: string;
}

/** 近さを言葉に翻訳する。数値を画面に出さないための層。 */
function nearnessWord(distance: number): string {
  if (distance < 0.35) return "いま飲んでいるものの、すぐ隣";
  if (distance < 0.7) return "半歩だけ外がわ";
  return "まだ行っていないほうへ";
}

/** 同じカテゴリーでまだ飲んでいない銘柄のうち、いまの自分に近い順に 3 件。 */
export function nextCups(): readonly NextCup[] {
  const drunk = new Set(TEA_CUPS.map((cup) => cup.teaId));
  const centre = recentCentre();
  return CATALOG_TEAS.filter(
    (tea) => tea.category === LOG_CATEGORY && !drunk.has(tea.id)
  )
    .map((tea) => {
      const dx = tea.x - centre.x;
      const dy = tea.y - centre.y;
      return { tea, distance: Math.hypot(dx, dy) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ tea, distance }) => ({ tea, nearness: nearnessWord(distance) }));
}
