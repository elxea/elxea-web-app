/**
 * 「わたしのお茶」— 飲んできた一杯の履歴 (ダミー 40 杯)。
 *
 * ## この層だけがダミーを持つ
 *
 * `lib/roji/tea-flavor.ts` と同じ契約。**描画側はデータの出どころを一切知らない**。
 * 実データ (注文履歴 / 記録アプリ) が来たら `TEA_CUPS` の組み立てだけを差し替え、
 * `components/viz/me/*` には手を入れない。
 *
 * 差し替え時に守る契約:
 * - `x` / `y` は -1..+1 の味の座標 (`lib/roji/tea-flavor.ts` と同じ軸)
 * - `index` は飲んだ順 (0 = いちばん古い)。`fresh` はその 0..1 正規化
 * - `daysAgo` は「いま」からの日数。時間レンズはこれだけで区間を決める
 * - **画面に数字を出さない** (roji 原則)。日付は `season` の言葉、回数は `nth` の
 *   漢数字が代わりに立つ。この層は算用数字を外に見せる文字列を作らない
 *
 * ## 時間の幅を 2 年半に取っている理由 (触ると UI が壊れる)
 *
 * 40 杯を「一年ちょっと」に置くと、時間レンズが
 * 全期間 40 / この一年 36 / この一ヶ月 3 になり **①と②が見分けられない**。
 * 40 / 24 / 6 に割れるよう、幅を約 2 年半 (`SPAN_DAYS`) に伸ばし、直近ほど密になる
 * 分布 (`daysAgo = SPAN × (1 - i/(N-1))^EXP`) を敷いてある。
 * 「最近よく飲むようになった」という自然な形にもなる。
 *
 * 出典: viz 査定 `verdicts.md` 第4ラウンド `22-footprints/history.js` /
 * 第6ラウンド `33-footprints-interactive/memory.js` / 第7ラウンド `31-flavor-interactive/log.js`。
 */

import {
  TEA_CATEGORY_COLOR,
  TEA_CATEGORY_LABEL,
  type TeaCategory,
} from "@/lib/roji/me/tea-catalog";
import { type TeaProcess } from "@/lib/roji/tea-flavor";
import { ROJI_VIZ_COLOR, seededRandom } from "@/lib/viz/roji-viz-palette";

/**
 * 履歴が属するカテゴリー。
 *
 * **1 枚の図に並べてよいのは同じカテゴリーのお茶だけ** (roji 確定ルール) なので、
 * 足あとの母集団も 1 カテゴリーに閉じる。ダミーでは緑茶を飲んできた人にした。
 * 実データでは「いま見ているカテゴリー」で履歴を絞り込んでからこの層に渡す。
 */
export const LOG_CATEGORY: TeaCategory = "green";
export const LOG_CATEGORY_LABEL = TEA_CATEGORY_LABEL[LOG_CATEGORY];
/** 足あとの色。カテゴリーの色そのもので、図の中で 1 色しか出ない。 */
export const LOG_COLOR = TEA_CATEGORY_COLOR[LOG_CATEGORY];

/** 履歴の母集団。すべて同じカテゴリー (緑茶) の 11 種。 */
export interface TeaSpecies {
  id: string;
  label: string;
  /** -1 = 甘み ←→ +1 = 渋み */
  x: number;
  /** +1 = 軽やか ←→ -1 = 濃厚 */
  y: number;
  /** 余韻の長さ (0.7..1.2)。マークの大きさ。 */
  weight: number;
  process: TeaProcess;
  note: string;
}

const SPECIES: readonly TeaSpecies[] = [
  { id: "tsuyuhikari", label: "つゆひかり", x: -0.44, y: 0.46, weight: 0.9, process: "mushi", note: "蜜のような甘み" },
  { id: "saemidori", label: "さえみどり", x: -0.72, y: 0.24, weight: 1.0, process: "mushi", note: "旨味の芯" },
  { id: "shiraore", label: "白折 茎茶", x: -0.8, y: 0.74, weight: 0.74, process: "mushi", note: "軽く澄んだ甘み" },
  { id: "genmaicha", label: "玄米茶", x: -0.16, y: 0.74, weight: 0.8, process: "hoiro", note: "香ばしさと軽さ" },
  { id: "gyokuro", label: "玉露 かぶせ", x: -0.74, y: -0.46, weight: 1.16, process: "mushi", note: "濃密な甘露" },
  { id: "hojicha", label: "ほうじ茶 強火", x: -0.08, y: -0.34, weight: 1.06, process: "hoiro", note: "深い焙煎の丸み" },
  { id: "zairai-kamairi", label: "在来 釜炒り", x: 0.24, y: 0.34, weight: 0.86, process: "kama", note: "素朴な渋み" },
  { id: "asamushi-yama", label: "浅蒸し 山", x: 0.58, y: 0.54, weight: 0.9, process: "kama", note: "涼やかな渋み" },
  { id: "fukamushi-yabukita", label: "深蒸し やぶきた", x: 0.48, y: -0.62, weight: 1.2, process: "mushi", note: "濃厚な渋みとコク" },
  { id: "bancha-hiboshi", label: "番茶 日干し", x: 0.34, y: 0.66, weight: 0.78, process: "kama", note: "素朴で軽い" },
  { id: "kabuse-shinme", label: "かぶせ 新芽", x: -0.62, y: -0.1, weight: 1.04, process: "mushi", note: "若い甘み" },
];

const SPECIES_BY_ID: ReadonlyMap<string, TeaSpecies> = new Map(
  SPECIES.map((tea) => [tea.id, tea])
);

/**
 * 飲んだ順 (古い → 新しい)。同じ茶が何度も出るのが「足あと」の要。
 *
 * 物語: 香ばしく軽い茶から入り、途中で四方に寄り道し、
 * やがて「甘み × 濃厚」の方へ落ち着いていく。**すべて緑茶の中での移動**で、
 * カテゴリーを跨がない (跨ぐと 1 枚の図に別カテゴリーが混ざる)。
 */
const DRINK_ORDER: readonly string[] = [
  // 入口 — 香ばしい・軽いあたりをうろうろ
  "genmaicha", "bancha-hiboshi", "hojicha", "asamushi-yama", "zairai-kamairi",
  "genmaicha", "zairai-kamairi", "asamushi-yama", "bancha-hiboshi", "hojicha",
  // 中盤 — 四方へ寄り道する時期
  "fukamushi-yabukita", "asamushi-yama", "tsuyuhikari", "zairai-kamairi", "hojicha",
  "fukamushi-yabukita", "shiraore", "bancha-hiboshi", "tsuyuhikari", "asamushi-yama",
  "fukamushi-yabukita", "genmaicha",
  // 直近 — 甘み・濃厚の方へ寄っていく
  "saemidori", "tsuyuhikari", "kabuse-shinme", "gyokuro", "saemidori",
  "hojicha", "gyokuro", "tsuyuhikari", "saemidori", "kabuse-shinme",
  "shiraore", "gyokuro", "saemidori", "fukamushi-yabukita", "kabuse-shinme",
  "tsuyuhikari", "gyokuro", "saemidori",
];

/**
 * 自分の一言 (ダミー)。飲んだ順に 1 対 1 で対応する。
 *
 * 季節の言葉と重複することは書かない (記憶カードに二度同じことが出るため)。
 */
const VOICES: readonly string[] = [
  "はじめて自分で選んで買った茶。何を基準にすればいいのか分からなかった",
  "湯を高いところから注いでも荒れない。気楽でいい",
  "夜に飲んでも眠れる、と知った日",
  "すっと涼しい。汗の引き際に飲みたくなる",
  "香りが素朴で、いくらでも飲み飽きない",
  "やっぱりここに戻ってくる",
  "山の畑の味がそのまま出ている気がする",
  "二煎目のほうが好きだと気づく",
  "作業しながら、ずっと横に置いていた",
  "冷めてからのほうが香りが分かる",
  "濃い。まだ持て余している",
  "涼しい渋み。夏のあいだ、よくこれを飲んだ",
  "蜜みたいな甘みがあることに驚いた",
  "湯をぬるくしたら、角が取れた",
  "客人に出したら、これが一番よろこばれた",
  "濃いのが悪いわけではない、と思い直す",
  "軽くて澄んでいる。朝に向く",
  "干し草の匂い。ふだん使いにちょうどいい",
  "一煎目をぬるく、ゆっくり待つ",
  "久しぶりに淹れたら、記憶よりずっと渋かった",
  "濃さの好みが少し変わってきた気がする",
  "はじめの頃によく飲んだ味。懐かしい",
  "旨味の芯がはっきりある",
  "これがいまの基準になりつつある",
  "若い甘み。春の匂いがした",
  "二煎で終わりにする贅沢",
  "湯冷ましを二度。手間をかけた分だけ甘い",
  "夜はやっぱりこれに戻る",
  "小さい茶碗で、少しずつ",
  "水出しにしてみた。角が丸くなる",
  "切らしているのに気づいて、慌てて注文した",
  "湿った空気の日でも、香りがよく立っていた",
  "甘い茶の合間に、これで口を戻す",
  "来客。いちばん良いものを出した",
  "淹れ方がようやく安定してきた",
  "たまに、うんと濃いのが飲みたくなる",
  "朝いちばん、まだ家が静かなうちに",
  "残っていた分を、惜しみながら",
  "ゆっくり時間をとれた日",
  "いまのところ、これが自分の真ん中",
];

/**
 * 「いま」を固定した基準日。
 *
 * 実行日に依存させると、スクリーンショットが日ごとに変わって比較できない。
 * ダミーである間はここを動かさない。
 */
const ANCHOR_UTC = Date.UTC(2026, 7, 16);
/** いちばん古い一杯までの日数 (約 2 年半)。 */
const SPAN_DAYS = 880;
/** 大きいほど直近が密になる。 */
const DENSITY_EXP = 1.75;

/** 季節の言葉。日付は出さない。 */
function seasonWord(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  switch (month) {
    case 1:
      return day <= 10 ? "年のはじめ" : "寒のさなか";
    case 2:
      return day <= 20 ? "冬のおわり" : "春の気配";
    case 3:
      return day <= 10 ? "春のはじめ" : "春のさなか";
    case 4:
      return "新芽のころ";
    case 5:
      return "新茶のころ";
    case 6:
      return "梅雨のころ";
    case 7:
      return day <= 10 ? "夏のはじめ" : "夏のさかり";
    case 8:
      return day <= 20 ? "夏のさかり" : "夏のおわり";
    case 9:
      return "秋のはじめ";
    case 10:
      return "秋のふかまり";
    case 11:
      return "秋のおわり";
    default:
      return day <= 20 ? "冬のはじめ" : "年のくれ";
  }
}

const KANJI_DIGIT = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 算用数字を画面に出さないための漢数字化 (1..99)。 */
export function kanjiNumber(n: number): string {
  if (n <= 0) return "〇";
  if (n < 10) return KANJI_DIGIT[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens > 1 ? KANJI_DIGIT[tens] : "") + "十" + KANJI_DIGIT[ones];
}

/** 一杯の記録。 */
export interface TeaCup {
  /** 飲んだ順 (0 = いちばん古い)。 */
  index: number;
  /** 銘柄の鍵。 */
  teaId: string;
  /** 銘柄名。 */
  label: string;
  /** 製法系統。**色には使わない**。銘柄カードの言葉としてだけ立つ。 */
  process: TeaProcess;
  /** この杯のカテゴリー。履歴は 1 カテゴリーに閉じているので全杯同じ。 */
  category: TeaCategory;
  /**
   * 描画色。**カテゴリーの色**。1 枚の図に載る杯は同じカテゴリーなので、
   * 足あとの図に出る色は 1 種類しかない (色が割れていたら比較対象を誤っている)。
   */
  color: string;
  /** 数値の代わりに置く一言 (銘柄そのものの説明)。 */
  note: string;
  weight: number;
  /** 味の座標。同じ銘柄でも淹れ方でその日の味は少しずれる。 */
  x: number;
  y: number;
  /** 0 = いちばん古い / 1 = いちばん新しい。 */
  fresh: number;
  /** その銘柄をこれまでに何度飲んだか (にじみの育ち方に使う)。 */
  count: number;
  /** 「いま」からの日数。時間レンズの区間はこれだけで決まる。 */
  daysAgo: number;
  /** 季節の言葉 (「夏のさかり」)。日付の代わり。 */
  season: string;
  /** 「四十杯目」。 */
  nth: string;
  /** 自分の一言。 */
  voice: string;
}

function buildCups(): readonly TeaCup[] {
  // 同じ茶でも淹れ方でその日の味は少しずれる → 基準点のまわりに小さく散らす。
  // これが無いと「同じ茶 = 完全に同一点」になり、堆積が濃い点 1 個に潰れる。
  const random = seededRandom(20260816);
  const total = DRINK_ORDER.length;

  const cups = DRINK_ORDER.map((teaId, index) => {
    const base = SPECIES_BY_ID.get(teaId);
    if (!base) throw new Error(`unknown tea id: ${teaId}`);
    const jitterX = (random() - 0.5) * 0.16;
    const jitterY = (random() - 0.5) * 0.16;
    const u = 1 - index / (total - 1);
    const daysAgo = Math.round(SPAN_DAYS * Math.pow(u, DENSITY_EXP)) + 2;
    const date = new Date(ANCHOR_UTC - daysAgo * 86_400_000);
    return {
      index,
      teaId,
      label: base.label,
      process: base.process,
      category: LOG_CATEGORY,
      // 色はカテゴリーが決める。系統では決めない。
      color: LOG_COLOR,
      note: base.note,
      weight: base.weight,
      x: Math.max(-0.97, Math.min(0.97, base.x + jitterX)),
      y: Math.max(-0.97, Math.min(0.97, base.y + jitterY)),
      fresh: index / (total - 1),
      count: 0,
      daysAgo,
      season: seasonWord(date),
      nth: `${kanjiNumber(index + 1)}杯目`,
      voice: VOICES[index],
    } satisfies TeaCup;
  });

  const counts = new Map<string, number>();
  for (const cup of cups) counts.set(cup.teaId, (counts.get(cup.teaId) ?? 0) + 1);
  for (const cup of cups) cup.count = counts.get(cup.teaId) ?? 1;
  return cups;
}

/** 飲んだ順に並んだ 40 杯。 */
export const TEA_CUPS: readonly TeaCup[] = buildCups();

/** 時間レンズ。「見る時間の幅」を決める。区間の終わりはスクラバーが決める。 */
export interface TimeLens {
  key: "all" | "year" | "month";
  label: string;
  /** この日数より新しい杯だけを見る。 */
  days: number;
  /** 区間のはじまりを言葉で言い直したもの (目盛りの代わり)。 */
  origin: string;
  /** その区間に入るいちばん古い杯の index。 */
  from: number;
  /** その区間に入る杯数。 */
  count: number;
}

export const TIME_LENSES: readonly TimeLens[] = (
  [
    { key: "all", label: "全 期 間", days: Number.POSITIVE_INFINITY, origin: "はじめのころ" },
    { key: "year", label: "こ の 一 年", days: 365, origin: "一年前のころ" },
    { key: "month", label: "こ の 一 ヶ 月", days: 31, origin: "一ヶ月前のころ" },
  ] as const
).map((lens) => {
  const from = TEA_CUPS.findIndex((cup) => cup.daysAgo <= lens.days);
  return { ...lens, from, count: TEA_CUPS.length - from };
});

/** `#rrggbb` を線形補間する。古い点を砂色へ寄せて「沈ませる」のに使う。 */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const ch = (u: number, v: number) =>
    Math.round(u + (v - u) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
}

/** 経年の見え方。 */
export interface AgedLook {
  radius: number;
  opacity: number;
  color: string;
}

/**
 * 堆積の見え方を決める既定カーブ。
 *
 * `age` は **表示区間の中で測り直した** 0..1 (0 = 区間内でいちばん古い)。
 * 全期間の物差しのまま一ヶ月を見ると 6 杯が全部「いま」の濃さで並び、
 * 区間の中の前後が消えるため、呼ぶ側が区間内で正規化してから渡す。
 */
export function agedLook(cup: TeaCup, age: number, baseRadius = 14): AgedLook {
  return {
    radius: baseRadius * (0.42 + 0.58 * age) * (0.86 + cup.weight * 0.16),
    // 二乗で「直近だけがくっきり」する。
    opacity: 0.12 + 0.55 * age * age,
    color: mixHex(ROJI_VIZ_COLOR.suna, cup.color, 0.12 + 0.88 * age),
  };
}

/** その銘柄を飲んだ杯 (新しい順)。銘柄カードの「これまでに」欄に使う。 */
export function cupsOfTea(teaId: string): readonly TeaCup[] {
  return TEA_CUPS.filter((cup) => cup.teaId === teaId).slice().reverse();
}

/** いちばん新しい一杯。ページ冒頭の「いまの一杯」に使う。 */
export const LATEST_CUP: TeaCup = TEA_CUPS[TEA_CUPS.length - 1];
