/**
 * 「みんなの気配」— みんな ⇄ 自分 のレンズのデータ層。
 *
 * ## 何の図か
 *
 * 産地の上に広がる **匿名集計のあたたかさ (気配)** と、その同じ面に置かれた
 * **自分の四十杯** を、一本の連続した数 (レンズ) で行き来する。レンズが
 * 「みんな」寄りのときは誰のものとも言えない密度の面だけが見え、「自分」へ
 * 動かすほど面が薄まり、自分の杯が面の中から立ち上がってくる。
 * **両端は別々の絵ではなく、同じ面を同じ物差しで見た二つの倍率**であることが
 * この図の主張なので、途中の位置がいちばん読めなければ意味がない。
 *
 * ## この面は「緑茶の気配」である (カテゴリーを跨がない)
 *
 * roji の確定ルール: **色はカテゴリー (緑茶 / 紅茶 / 青茶) を表し、1 枚の図に
 * 並べてよいのは同じカテゴリーのお茶だけ**。したがってこの図に載るものは
 * 面も点も**すべて緑茶**で、画面に出る色は `COMMUNITY_COLOR` (苔) の 1 色しかない。
 * 濃淡が量の多寡、色がカテゴリー — この役割分担を崩さない。図の中で色が割れて
 * いたら、それはカテゴリーを跨いだ比較をしている印 = 欠陥である。
 *
 * そのため **集計の母集団も緑茶の産地に閉じる**。`GREEN_MENU_NUMBERS` が
 * その母集団で、紅茶・青茶しか出さない産地はこの面に現れない
 * (現れたら「緑茶の気配」に別カテゴリーの土地が混ざる)。
 *
 * ## 原型からの縮約 (地図をやめた理由)
 *
 * 原型 (`32-community-interactive/01-lens.html` + `lens.js`) は Mapterhorn の
 * DEM タイルから日本列島と静岡の版を焼き、Web Mercator の世界座標に粒と行灯を
 * 置いて「日本列島 ⇄ 静岡」のズームで尺度を横断していた。ここはその**地図の側を
 * 全部落とす**。理由は 3 つ:
 *
 * 1. このページは **ダミーデータの自己完結したモックアップ**で、実行時に外部へ
 *    1 バイトも出さない前提 (タイル取得・API キー・ネットワーク一切なし)。
 * 2. 原型の「尺度の横断」の本体は **地理のズームではなく「みんな ⇄ 自分」の
 *    倍率**である。地図はその舞台にすぎず、舞台を落としても主張は落ちない。
 * 3. 実際の産地は西日本に偏っていて、列島の輪郭を描くと**画面のほとんどが海**に
 *    なる。輪郭を捨てて産地の相対位置だけを残すほうが、気配の面はよく見える。
 *
 * 残したのは「みんなの気配 = 面」「自分 = 面から立つ粒」「触れると土地の言葉」の
 * 三つ。舞台は地図ではなく **生成りの紙の上の抽象的な産地の面** になった。
 * 産地の並びだけは実座標 (`lib/roji/tea-origins.ts` の緯度経度) を Mercator で
 * 正規化して使っている — 東西南北の関係が嘘だと、産地名を出したときに読み手が
 * 引っかかるため。海岸線・県境・段彩は一切描かない。
 *
 * ## 差し替え契約 (`lib/roji/tea-flavor.ts` と同じ約束)
 *
 * 実データ (匿名集計 API / 注文履歴) が来たら **この層だけ**を差し替える。
 * `components/viz/me/community/*` には手を入れない。実装側が満たすべき条件:
 *
 * - **カテゴリーを 1 つに絞ってから渡す**。複数カテゴリーを混ぜた集計を作らない
 *   (混ぜた瞬間、色が意味を失う)
 * - `CommunityPlace.warmth` は **0..1 に正規化済みの集計値**。杯数・人数・順位の
 *   生の値をここへ入れない (画面に出ないとしても、型が持てば必ず漏れる)
 * - 集計は **産地単位まで**。個人・世帯・端末を特定しうる粒度は受け取らない。
 *   最小集計単位を割る産地は `warmth` を 0 にして落とすのが呼び出し側の責務
 * - `phrase` は土地の気配を述べる言葉。数・割合・順位を含めない
 * - 自分の側は `lib/roji/me/tea-log.ts` の `TEA_CUPS` がそのまま正本。実ログは
 *   一杯ごとに銘柄番号を持つので、その時点で下の `CUP_MENU_NUMBER` は消え、
 *   `resolveTeaOrigin(cup.menuNumber)` だけが残る
 * - 画面に算用数字を出さない (roji 原則)。数を言う必要があるときは
 *   `kanjiNumber` を通す
 *
 * ## 匿名性について (削ってはいけない前提)
 *
 * この層が持つ「みんな」は **産地ごとの一つの実数だけ**で、行が人に対応する
 * 配列を一切持たない。画面に撒く粒は集計値から起こした装飾であって、誰か一人の
 * 一杯ではない。原型は「毎秒 7 粒が舞い落ちる = いま誰かが一杯飲んだ」を
 * 見せていたが、**一粒が一人の行為に見える表現はここでは採らない**。集計の面に
 * 個人の出来事を混ぜた瞬間、匿名集計という約束が絵の側から崩れるため。
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド 32 (32-community-interactive) /
 * 第4ラウンド 23 (23-community-map/field.js の密度場)。
 */

import { type TeaCategory } from "@/lib/roji/me/tea-catalog";
import {
  LOG_CATEGORY,
  LOG_CATEGORY_LABEL,
  LOG_COLOR,
  TEA_CUPS,
  agedLook,
  cupsOfTea,
  kanjiNumber,
  mixHex,
  type TeaCup,
} from "@/lib/roji/me/tea-log";
import {
  TEA_MENU_NUMBERS,
  resolveTeaOrigin,
  teaOriginPoints,
} from "@/lib/roji/tea-origins";
import {
  ROJI_VIZ_COLOR,
  clamp01,
  rampFn,
  seededRandom,
} from "@/lib/viz/roji-viz-palette";

/* ──────────────────────────────────────────────────────────── カテゴリー */

/** この図が扱う唯一のカテゴリー。足あと (`tea-log`) と必ず同じものを見る。 */
export const COMMUNITY_CATEGORY: TeaCategory = LOG_CATEGORY;
/** 画面に出すカテゴリー名 (凡例の 1 行はこれと `COMMUNITY_COLOR` だけ)。 */
export const COMMUNITY_CATEGORY_LABEL = LOG_CATEGORY_LABEL;
/** 図に出る唯一の色。カテゴリーの色そのもの。 */
export const COMMUNITY_COLOR = LOG_COLOR;

/**
 * カテゴリーの母集団になる銘柄番号。
 *
 * `lib/roji/tea-origins.ts` の対応表は銘柄番号の**先頭桁がカテゴリー**
 * (1 = 緑茶 / 4 = 青茶 / 5 = 紅茶) になっていて、同ファイルの区切りコメントが
 * その並びを示している。ここではその規則で緑茶だけを取る。
 * **実データではカテゴリーを推定しない** — 集計 API がカテゴリーを明示して渡し、
 * この定数は消える (差し替え契約)。
 */
const CATEGORY_MENU_PREFIX: Record<TeaCategory, string> = {
  green: "1",
  blue: "4",
  black: "5",
};

/** 緑茶の銘柄番号 = この面の母集団。 */
export const GREEN_MENU_NUMBERS: readonly string[] = TEA_MENU_NUMBERS.filter(
  (menuNumber) => menuNumber.startsWith(CATEGORY_MENU_PREFIX[COMMUNITY_CATEGORY])
);

/* ────────────────────────────────────────────────────────── 座標 (抽象の面) */

const D2R = Math.PI / 180;
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const r = lat * D2R;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/** 母集団の産地 (座標が同じ仕入先は 1 点に畳まれる)。 */
const ORIGIN_POINTS = teaOriginPoints(GREEN_MENU_NUMBERS);

/**
 * 面の縦横比 (横 = 1 としたときの縦)。
 *
 * 産地の外接矩形をそのまま使う。**縦横で別々に伸ばさない** — 別々に伸ばすと
 * 「北へ行くほど東へ寄る」ような嘘の並びになり、産地名を出したときに破綻する。
 */
export const PLANE_HEIGHT: number = (() => {
  const xs = ORIGIN_POINTS.map((p) => mercX(p.lng));
  const ys = ORIGIN_POINTS.map((p) => mercY(p.lat));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return spanY / spanX;
})();

/* ──────────────────────────────────────────────────────────── 産地の顔と気配 */

interface PlaceVoice {
  /** 画面に出す短い名。正式名 (「西臼杵郡五ヶ瀬町」) は字面が重すぎる。 */
  name: string;
  /** 土地の気配。数・割合・順位を含めない。 */
  phrase: string;
  /**
   * 匿名集計のあたたかさ (0..1 の正規化済み)。**ダミー**。
   * 自分の分布とはわざと違う形にしてある — 同じ形だとレンズを動かしても
   * 絵が変わらず、「みんな」と「自分」が別物であることが見えない。
   * (自分がいちばん通うのは静岡、みんなの気配がいちばん濃いのは八女)
   */
  warmth: number;
  /**
   * 名札を点の左右どちらへ逃がすか。
   *
   * 実座標をそのまま使うと、緑茶の産地は **静岡 / 川根** と **南山城 / 山添** が
   * 画面上で数十 px しか離れず、名札が必ず重なる (原型 23 / 32 が `side` と `dy`
   * を持っていたのと同じ理由。あちらは牧之原と川根で踏んだ)。左右に振り分け、
   * さらに上下へずらすことでしか解けない。
   */
  labelSide: "l" | "r";
  /** 名札の上下のずらし (px)。近接する産地どうしを引き離すためだけの値。 */
  labelDy: number;
}

/**
 * 産地ごとの言葉と集計値。鍵は `${都道府県}|${市町村}`
 * (`lib/roji/tea-origins.ts` が返す組。ここで新しい産地を作らない)。
 */
const PLACE_VOICE: Record<string, PlaceVoice> = {
  "静岡県|静岡市": {
    name: "静岡",
    phrase: "川風がいつも茶をなでている",
    warmth: 0.62,
    labelSide: "l",
    labelDy: 17,
  },
  "静岡県|榛原郡川根本町": {
    name: "川根",
    phrase: "谷が霧をためる。朝いちばんに白くなる",
    warmth: 0.36,
    labelSide: "l",
    labelDy: -15,
  },
  "奈良県|山添村": {
    name: "山添",
    phrase: "高原の冷えが、葉をゆっくり育てる",
    warmth: 0.56,
    labelSide: "r",
    labelDy: 14,
  },
  "京都府|相楽郡南山城村": {
    name: "南山城",
    phrase: "川霧が覆いになる。日陰で育った葉はやわらかい",
    warmth: 0.44,
    labelSide: "l",
    labelDy: -14,
  },
  "福岡県|八女市": {
    name: "八女",
    phrase: "山あいの朝もやが、渋みを丸くしていく",
    warmth: 0.95,
    labelSide: "r",
    labelDy: -15,
  },
  "宮崎県|西臼杵郡五ヶ瀬町": {
    name: "五ヶ瀬",
    phrase: "いちばん高いところの畑。霜と隣り合わせ",
    warmth: 0.8,
    labelSide: "r",
    labelDy: 15,
  },
};

/**
 * 面の上の一つの産地。
 *
 * `category` は面の全体で 1 つ (`COMMUNITY_CATEGORY`)。産地ごとに違う値を持てる
 * 形にはしない — 持てる形にした時点で、カテゴリーを跨いだ面が作れてしまう。
 */
export interface CommunityPlace {
  /** `${都道府県}|${市町村}`。 */
  id: string;
  /** 画面に出す短い名。 */
  name: string;
  /** 土地の気配 (数を含まない言葉)。 */
  phrase: string;
  /** 匿名集計のあたたかさ (0..1)。 */
  warmth: number;
  /** 面の横位置 (0..1)。 */
  u: number;
  /** 面の縦位置 (0..`PLANE_HEIGHT`)。 */
  v: number;
  /** 名札を点の左右どちらへ逃がすか (近接する産地の重なりを解くため)。 */
  labelSide: "l" | "r";
  /** 名札の上下のずらし (px)。 */
  labelDy: number;
}

/** 面の上の産地。実座標由来の並びに、言葉と集計値を載せたもの。 */
export const COMMUNITY_PLACES: readonly CommunityPlace[] = (() => {
  const xs = ORIGIN_POINTS.map((p) => mercX(p.lng));
  const ys = ORIGIN_POINTS.map((p) => mercY(p.lat));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;

  return ORIGIN_POINTS.map((point, index) => {
    const id = `${point.prefecture}|${point.area ?? ""}`;
    const voice = PLACE_VOICE[id];
    return {
      id,
      name: voice?.name ?? point.area ?? point.prefecture,
      phrase: voice?.phrase ?? "",
      warmth: voice?.warmth ?? 0.3,
      u: (xs[index] - minX) / spanX,
      v: (ys[index] - minY) / spanX,
      labelSide: voice?.labelSide ?? "r",
      labelDy: voice?.labelDy ?? 0,
    } satisfies CommunityPlace;
  });
})();

const PLACE_BY_ID: ReadonlyMap<string, CommunityPlace> = new Map(
  COMMUNITY_PLACES.map((place) => [place.id, place])
);

/* ───────────────────────────────────────────────── 自分の四十杯を同じ面に置く */

/**
 * 銘柄 → 銘柄番号の仮結線 (**ダミー同士をつなぐためだけの表**)。
 *
 * `TEA_CUPS` は味の座標の側のダミーで銘柄番号を持たず、
 * `lib/roji/tea-origins.ts` は銘柄番号でしか産地を引けない。実ログは一杯ごとに
 * 銘柄番号を持つので、そのときこの表は消える (差し替え契約を参照)。
 *
 * **番号はすべて緑茶 (先頭 1) から選ぶ**。履歴が緑茶に閉じている以上、産地も
 * 緑茶の産地でなければ、面と点でカテゴリーが食い違う。
 */
const CUP_MENU_NUMBER: Record<string, string> = {
  tsuyuhikari: "10101",
  "fukamushi-yabukita": "10201",
  shiraore: "10901",
  genmaicha: "11001",
  "bancha-hiboshi": "11101",
  gyokuro: "10701",
  hojicha: "10801",
  "zairai-kamairi": "10601",
  "asamushi-yama": "10401",
  saemidori: "11601",
  "kabuse-shinme": "11701",
};

/** 面の上に置かれた一杯。 */
export interface CommunityCup {
  cup: TeaCup;
  /** どの産地に属するか。 */
  placeId: string;
  /** 面の横位置 (産地の中でのばらけを含む)。 */
  u: number;
  /** 面の縦位置。 */
  v: number;
}

/**
 * いちばん通った産地の杯が広がる半径 (面の単位)。
 *
 * 同じ産地の杯を完全に同じ点に置くと、いちばん濃い産地が点 1 個に潰れて
 * 「四十杯ある」ことが絵から消える (`tea-log.ts` が味の座標で踏んだのと同じ罠)。
 *
 * 値の上限は **隣の産地までの距離**で決まる。緑茶の産地は静岡と川根が面の上で
 * 0.04 しか離れておらず、産地ごとに同じ半径で撒くと二つの群れが混ざって
 * 「どちらの土地の杯か」が読めなくなる。よって半径は杯数に比例させ、
 * いちばん通った産地だけがこの値まで広がる。
 */
const CUP_SPREAD = 0.034;
/** 黄金角。等間隔に見えて重ならない並び (ひまわりの種と同じ)。 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 面の上に置いた四十杯 (飲んだ順)。 */
export const COMMUNITY_CUPS: readonly CommunityCup[] = (() => {
  const random = seededRandom(20260817);
  const byPlace = new Map<string, TeaCup[]>();

  for (const cup of TEA_CUPS) {
    const menuNumber = CUP_MENU_NUMBER[cup.teaId];
    if (!menuNumber) continue;
    const origin = resolveTeaOrigin(menuNumber);
    if (!origin.prefecture) continue;
    const id = `${origin.prefecture}|${origin.area ?? ""}`;
    if (!PLACE_BY_ID.has(id)) continue;
    const list = byPlace.get(id);
    if (list) list.push(cup);
    else byPlace.set(id, [cup]);
  }

  // いちばん通った産地を基準に半径を割る (少ない産地の群れは小さく締まる)。
  const most = Math.max(1, ...[...byPlace.values()].map((cups) => cups.length));

  const out: CommunityCup[] = [];
  for (const [id, cups] of byPlace) {
    const place = PLACE_BY_ID.get(id);
    if (!place) continue;
    cups.forEach((cup, i) => {
      const angle = i * GOLDEN_ANGLE + (random() - 0.5) * 0.6;
      const radius = CUP_SPREAD * Math.sqrt((i + 0.55) / most);
      out.push({
        cup,
        placeId: id,
        u: place.u + Math.cos(angle) * radius,
        v: place.v + Math.sin(angle) * radius * 0.86,
      });
    });
  }
  // 飲んだ順に戻す。古い杯から描くと新しい杯が上に載る (堆積の順序)。
  return out.sort((a, b) => a.cup.index - b.cup.index);
})();

/** 産地ごとの自分の足あと。数は画面に出さず、言葉と濃さにだけ使う。 */
export interface PlaceFootprint {
  /** その産地で飲んだ杯 (新しい順)。 */
  cups: readonly TeaCup[];
  /** 0..1。いちばん通った産地が 1。 */
  depth: number;
}

export const PLACE_FOOTPRINT: ReadonlyMap<string, PlaceFootprint> = (() => {
  const teaIdsByPlace = new Map<string, Set<string>>();
  for (const entry of COMMUNITY_CUPS) {
    const set = teaIdsByPlace.get(entry.placeId);
    if (set) set.add(entry.cup.teaId);
    else teaIdsByPlace.set(entry.placeId, new Set([entry.cup.teaId]));
  }

  const raw = new Map<string, readonly TeaCup[]>();
  for (const [placeId, teaIds] of teaIdsByPlace) {
    // `cupsOfTea` は銘柄ごとに新しい順で返る。産地はその合流なので並べ直す。
    const cups = [...teaIds]
      .flatMap((teaId) => cupsOfTea(teaId))
      .sort((a, b) => b.index - a.index);
    raw.set(placeId, cups);
  }

  const most = Math.max(1, ...[...raw.values()].map((cups) => cups.length));
  const out = new Map<string, PlaceFootprint>();
  for (const [placeId, cups] of raw) {
    out.set(placeId, { cups, depth: cups.length / most });
  }
  return out;
})();

/* ───────────────────────────────────────────────────────────── 気配の密度場 */

/**
 * にじみの広がり (面の単位)。
 *
 * 産地の間隔よりわずかに広く取る。狭いと産地ごとの点が離れて「地図の点」に
 * 戻ってしまい、広すぎると一枚の平らな靄になって産地の偏りが消える。
 */
const WARMTH_SIGMA = 0.2;
const TWO_SIGMA_SQ = 2 * WARMTH_SIGMA * WARMTH_SIGMA;

/** 面の揺らぎ。等方なガウスの重ね合わせは滑らかすぎて印刷物に見えないため。 */
function wobble(u: number, v: number): number {
  return (
    Math.sin(u * 7.3 + 1.1) * Math.cos(v * 9.7 - 0.4) +
    0.55 * Math.sin(u * 13.9 - 2.2) * Math.sin(v * 17.1 + 0.9)
  );
}

function rawWarmth(u: number, v: number): number {
  let sum = 0;
  for (const place of COMMUNITY_PLACES) {
    const du = u - place.u;
    const dv = v - place.v;
    sum += place.warmth * Math.exp(-(du * du + dv * dv) / TWO_SIGMA_SQ);
  }
  // 揺らぎは合計に掛ける。足すと産地の無いところにも気配が湧いてしまう。
  return sum * (1 + 0.22 * wobble(u, v));
}

/** 正規化用の峰。面の外まで少し広げて測る (端が切れると縁だけ濃く見える)。 */
const WARMTH_PEAK: number = (() => {
  let peak = 0;
  for (let j = 0; j <= 48; j++) {
    for (let i = 0; i <= 96; i++) {
      const value = rawWarmth(
        -0.15 + (i / 96) * 1.3,
        -0.15 + (j / 48) * (PLANE_HEIGHT + 0.3)
      );
      if (value > peak) peak = value;
    }
  }
  return peak || 1;
})();

/** 面の任意の点のあたたかさ (0..1)。産地の外へなだらかに落ちる。 */
export function crowdWarmth(u: number, v: number): number {
  return clamp01(rawWarmth(u, v) / WARMTH_PEAK);
}

/**
 * 気配の面の色域。**生成り (紙) → 苔 (カテゴリーの色) の一色相の濃淡だけ**。
 *
 * 段彩 (複数色の色分け) にしない。色分けにすると「色はカテゴリー」という
 * 約束と衝突して、濃さが量なのか色が種類なのかが読み手に判別できなくなる。
 * 中間の淡い苔は同じ色相上の点で、新しい色を足しているわけではない。
 */
const WARMTH_RAMP = [
  [0, ROJI_VIZ_COLOR.kinari],
  [0.45, ROJI_VIZ_COLOR.usukoke],
  [1, COMMUNITY_COLOR],
] as const;

const warmthColor = rampFn(WARMTH_RAMP);

/** 密度 (0..1) → `ImageData` に置く RGBA。紙を透かすので alpha も密度で決まる。 */
export function warmthPixel(
  density: number
): [number, number, number, number] {
  const [r, g, b] = warmthColor(density);
  // 0.85 乗で薄いところの立ち上がりを早める (面の縁が唐突に切れない)。
  const alpha = Math.pow(clamp01(density * 1.15), 0.85) * 0.9;
  return [r, g, b, Math.round(alpha * 255)];
}

/* ────────────────────────────────────────────────────────────── 面 → 画面 */

/** 面を枠に収める変換。 */
export interface PlaneFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const PAD_X = 0.12;
const PAD_Y = 0.14;

/**
 * 面を枠の中央に収める (縦横同じ倍率)。
 *
 * 枠いっぱいに引き伸ばさないのは、産地の並びが実座標由来だから
 * (横だけ伸ばすと東西の距離感が嘘になる)。余白は産地名の逃げ場も兼ねる。
 */
export function fitPlane(width: number, height: number): PlaneFit {
  const scale = Math.min(
    width * (1 - PAD_X * 2),
    (height * (1 - PAD_Y * 2)) / PLANE_HEIGHT
  );
  return {
    scale,
    offsetX: (width - scale) / 2,
    offsetY: (height - scale * PLANE_HEIGHT) / 2,
  };
}

export const planeToScreenX = (fit: PlaneFit, u: number) =>
  fit.offsetX + u * fit.scale;
export const planeToScreenY = (fit: PlaneFit, v: number) =>
  fit.offsetY + v * fit.scale;
export const screenToPlaneU = (fit: PlaneFit, x: number) =>
  (x - fit.offsetX) / fit.scale;
export const screenToPlaneV = (fit: PlaneFit, y: number) =>
  (y - fit.offsetY) / fit.scale;

/** 画面の点にいちばん近い産地。しきい値の外なら null。 */
export function nearestPlace(
  fit: PlaneFit,
  x: number,
  y: number,
  maxDistance: number
): CommunityPlace | null {
  let best: CommunityPlace | null = null;
  let bestDistance = maxDistance;
  for (const place of COMMUNITY_PLACES) {
    const dx = planeToScreenX(fit, place.u) - x;
    const dy = planeToScreenY(fit, place.v) - y;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  return best;
}

/* ────────────────────────────────────────────────────────────────── 見え方 */

/** `#rrggbb` と不透明度から `rgba()` を組む。Canvas はトークンを解決できない。 */
export function rgbaOf(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${clamp01(alpha).toFixed(3)})`;
}

/** 一杯の見え方。 */
export interface CupAppearance {
  radius: number;
  fill: string;
  /** 輪。自分側でだけ現れる (みんな側では粒と区別がつかないのが正しい)。 */
  ring: string | null;
}

/**
 * レンズ (0 = みんな / 1 = 自分) の一本の数だけで杯の見え方を決める。
 *
 * **両端で別の描き方に切り替えない**。切り替えると中間が「二枚の絵の重ね」に
 * なり、同じ物差しの上を動いているという主張が壊れる。よって半径・色・不透明度
 * すべてを `lens` の線形補間で出す。0 のときは粒 (`crowdGrainStyle`) と同じ
 * 大きさ・同じ色に沈み、1 で `agedLook` の堆積そのものになる。
 *
 * 色は**カテゴリーの色の濃淡の中だけ**を動く (淡い苔 ⇄ 苔)。杯ごとに色を割ると
 * 「色は何を表すのか」が二重になる。古い杯が砂色へ寄るのは `agedLook` が持つ
 * **経年 = 紙へ沈む**の表現で、別カテゴリーの色ではない。
 */
export function cupAppearance(
  cup: TeaCup,
  lens: number,
  basePx: number
): CupAppearance {
  const t = clamp01(lens);
  // `age` は全期間で測った 0..1 (`cup.fresh`)。古い杯ほど小さく淡く沈む。
  const look = agedLook(cup, cup.fresh, basePx);
  const radius = 1 + (look.radius * 0.55 - 1) * t;
  const fill = rgbaOf(
    mixHex(ROJI_VIZ_COLOR.usukoke, look.color, t),
    0.34 + (look.opacity * 1.5 - 0.34) * t
  );
  // 輪は途中から。最初から出すと「自分の点」が最初から名指しされてしまう。
  // 色は苔の暗部 = 同じ色相の濃い側で、別の色を持ち込まない。
  const ring =
    t > 0.35
      ? rgbaOf(ROJI_VIZ_COLOR.fukamidori, (0.34 * (t - 0.35)) / 0.65)
      : null;
  return { radius, fill, ring };
}

/** 気配の粒の色 (カテゴリーの色)。 */
export const crowdGrainStyle = (alpha: number) => rgbaOf(COMMUNITY_COLOR, alpha);

/** 自分の産地に差す灯り。色はカテゴリーのまま、濃さだけが立つ。 */
export const selfGlowStyle = (alpha: number) => rgbaOf(COMMUNITY_COLOR, alpha);

/** 産地名の文字色と、その下に敷く紙色の縁取り。 */
export const labelInkStyle = (alpha: number) => rgbaOf(ROJI_VIZ_COLOR.sumi, alpha);
export const labelHaloStyle = (alpha: number) =>
  rgbaOf(ROJI_VIZ_COLOR.kinari, alpha);

/* ──────────────────────────────────────────────────────────────── ことば */

/** レンズの両端に置く墨の語。 */
export const LENS_ENDS = { crowd: "み ん な", self: "じ ぶ ん" } as const;

/** レンズの操作そのものの名 (スクリーンリーダー用)。 */
export const LENS_CONTROL_LABEL = "みんな と じぶん のあいだのレンズ";

/**
 * レンズの位置を言葉で言い直したもの (`aria-valuetext`)。
 *
 * 目盛りも百分率も読み上げない。数を読み上げた瞬間、この図が
 * 「数を隠したダッシュボード」になってしまう。
 */
export function lensVoice(lens: number): string {
  const t = clamp01(lens);
  if (t < 0.12) return "みんなの気配のなか。自分の杯はまだ沈んでいる";
  if (t < 0.36) return "みんなの気配のなかに、うっすら自分の杯";
  if (t < 0.64) return "みんなと自分のあいだ。どちらも見えている";
  if (t < 0.88) return "自分の足あとが立ちはじめ、みんなの気配は薄れていく";
  return "自分の足あとのなか。みんなの気配はうしろに退いた";
}

/** 図の下に置く一行 (触れる前のうながし)。 */
export const COMMUNITY_HINT = "産 地 に 触 れ る と 、 そ の 土 地 の 気 配";

/** みんな側の一行。集計であることをここで言い切る。 */
export const CROWD_SUMMARY = "だ れ の も の と も 言 え な い あ た た か さ";

/**
 * 自分側の一行。数を言う必要があるので `kanjiNumber` を通す
 * (算用数字を画面に出さない roji 原則)。
 */
export const SELF_SUMMARY = `${kanjiNumber(COMMUNITY_CUPS.length)}杯 が ${kanjiNumber(
  PLACE_FOOTPRINT.size
)}つ の 産 地 に か さ な る`;

/** 触れたときに出す短い読み。 */
export interface PlaceReading {
  name: string;
  phrase: string;
  /** 自分側でだけ足される一行。数・割合は含めない。 */
  footprint: string | null;
}

/**
 * 産地の読み。
 *
 * レンズが自分寄りのときだけ「自分の一行」が足される。**回数は言わない** —
 * 数えられる形にすると、隣の産地との比較が始まって気配の図でなくなる。
 * 代わりに `cupsOfTea` が返すいちばん新しい一杯の銘柄と季節を置く。
 */
export function placeReading(placeId: string, lens: number): PlaceReading | null {
  const place = PLACE_BY_ID.get(placeId);
  if (!place) return null;
  const footprint = PLACE_FOOTPRINT.get(placeId);
  if (lens < 0.4) {
    return { name: place.name, phrase: place.phrase, footprint: null };
  }
  if (!footprint || footprint.cups.length === 0) {
    return {
      name: place.name,
      phrase: place.phrase,
      footprint: "ま だ 、 こ こ の お 茶 を 知 ら な い",
    };
  }
  const latest = footprint.cups[0];
  return {
    name: place.name,
    phrase: place.phrase,
    footprint: `${latest.label} ・ ${latest.season} に`,
  };
}
