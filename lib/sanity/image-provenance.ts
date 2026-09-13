/**
 * Sanity の画像フィールド (`mainImage` / `thumbnail`) を「人間の微調整を消さずに」
 * 同期するための判定。ここは純関数だけ (IO なし) なのでそのままテストできる。
 *
 * ## なぜ要るか (2026-09-13)
 *
 * 運用の前提は「配置はエージェントが決め、**並び替え・トリミング・位置調整・
 * 一部差し替えはアセットハブ上で人間がやる**」。ところが毎時の
 * `scripts/sync-notion-to-sanity.ts` は画像フィールドを
 * `{ _type:"image", asset, alt: 記事タイトル }` の **オブジェクトごと** 書いて
 * いたため、
 *   - 人が直した `alt` が毎回 記事タイトルで塗り潰される
 *   - Sanity 側にしか無い `hotspot` / `crop` (= トリミング位置) が毎回消える
 * という状態だった (実測: origin/main 3de76d5, L1196 / L1212)。
 * 人間の微調整が次の同期で消えるなら「微調整は人間がやる」は成立しない。
 *
 * ## 正本 (SoT) をどこに置くか — 二重管理にしない
 *
 * - **`alt` の正本は Sanity の `image.alt`**。人が調整する場所が正本である。
 *   Notion の記事タイトルは *初期値の種* でしかなく、正本ではない。
 *   したがって同期は「まだ誰も書いていない」か「自分 (agent) が最後に書いた値の
 *   まま」のときだけ alt を書く。
 * - **`hotspot` / `crop` の正本も Sanity**。Notion 側に対応する値が無いので、
 *   同期はこの 2 つを **一度も書かない** (書かなければ消えない)。
 *   展開は `scripts/lib/sanity-upsert.ts` のドットパス化が担当する。
 * - **出所 (`assignedBy`) の語彙の正本は elxea-asset-hub `lib/asset-provenance.ts`**
 *   (merge `ef2c463`)。ここはその read 側の最小移植で、必要な述語
 *   (「agent と分かっているものか」) だけを持つ。値の意味を増やさないこと。
 *
 * ## フェイルセーフの向き
 *
 * 充填側 (`elxea-asset-hub scripts/lib/photo-fill-guard.mjs`) と同じ向きに倒す:
 * **`agent` と分かっているものだけ上書きしてよい。`human` はもちろん `unknown`
 * でも触らない。** 既存の本番データには出所が無い = すべて `unknown` なので、
 * この変更が入った直後は 1 件も alt を上書きしない。これは意図した挙動である
 * (出所不明を「自動が入れたもの」と推定しない)。
 */

/** 割当を入れたのは誰か。語彙の正本は asset-hub `lib/asset-provenance.ts`。 */
export type AssignedBy = "agent" | "human" | "unknown";

/** 同期が自分で書いたものに残す出所。 */
export const AGENT_ASSIGNED_BY: AssignedBy = "agent";

/** 出所が読めないときに倒す先。`agent` ではない。 */
export const ASSIGNED_BY_FALLBACK: AssignedBy = "unknown";

/**
 * 表記ゆれ -> 正規値。asset-hub 側の `ASSIGNED_BY_ALIASES` と同じ集合。
 * ここに無い値はすべて `unknown` に倒れる (未知の文字列が `agent` にならない)。
 */
const ASSIGNED_BY_ALIASES: Readonly<Record<string, AssignedBy>> = Object.freeze({
  agent: "agent",
  bot: "agent",
  automation: "agent",
  エージェント: "agent",
  自動: "agent",
  human: "human",
  person: "human",
  人間: "human",
  手動: "human",
  unknown: "unknown",
  不明: "unknown",
});

/** 何が来ても `AssignedBy` にする。未設定・空・未知・非文字列は `unknown`。 */
export function normalizeAssignedBy(value: unknown): AssignedBy {
  if (typeof value !== "string") return ASSIGNED_BY_FALLBACK;
  const key = value.trim().toLowerCase();
  if (key === "") return ASSIGNED_BY_FALLBACK;
  return ASSIGNED_BY_ALIASES[key] ?? ASSIGNED_BY_FALLBACK;
}

/**
 * 「この割当をエージェントが自動で上書きしてよいか」。
 * **`agent` のときだけ true**。`human` も `unknown` も false。
 */
export function isAgentOverwritable(value: unknown): boolean {
  return normalizeAssignedBy(value) === AGENT_ASSIGNED_BY;
}

/** 同期の直前に Sanity から読んだ、その画像フィールドの現状。 */
export interface ExistingImageField {
  /** その画像フィールドが Sanity に既に存在するか。 */
  exists: boolean;
  /** 現在の説明文。 */
  alt?: unknown;
  /** 現在の出所。 */
  assignedBy?: unknown;
  /** エージェントが最後に書いた説明文 (人が直したかの判定に使う)。 */
  agentAlt?: unknown;
}

/** なぜその結論になったか。ログとテストで読むためのラベル。 */
export type ImageAltDecision =
  /** まだ誰も書いていない -> 種を入れる */
  | "seed"
  /** 出所が agent かつ人が触った形跡なし -> 更新する */
  | "refresh"
  /** 出所が human -> 触らない */
  | "keep-human"
  /** 出所は agent だが alt が書いた値から変わっている (人が直した) -> 触らない */
  | "keep-edited"
  /** 出所不明 -> 触らない */
  | "keep-unknown";

export interface ImageFieldWritePlan {
  /** 画像フィールドに書くサブフィールド (ここに無いキーは一切書かない)。 */
  fields: { alt?: string; assignedBy?: AssignedBy; agentAlt?: string };
  decision: ImageAltDecision;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 画像フィールドについて「alt と出所を書くか / 書かないか」を決める。
 *
 * `hotspot` / `crop` はここに一切現れない = 同期は書かない = 消えない。
 * `asset` は呼び出し側が常に書く (画像そのものの差し替えは台帳が正本)。
 *
 * @param candidateAlt 同期が持っている説明文の候補 (記事タイトル)。
 * @param existing     Sanity の現状。未取得・新規は `undefined`。
 */
export function planImageFieldWrite(
  candidateAlt: string,
  existing?: ExistingImageField
): ImageFieldWritePlan {
  const seed = (): ImageFieldWritePlan => ({
    fields: {
      alt: candidateAlt,
      assignedBy: AGENT_ASSIGNED_BY,
      agentAlt: candidateAlt,
    },
    decision: "seed",
  });

  // まだ画像が無い / 現状が読めなかった -> 守るべき人の調整は存在しない。
  if (!existing || !existing.exists) return seed();

  const by = normalizeAssignedBy(existing.assignedBy);

  // 人が入れたと分かっている -> 何も書かない。
  if (by === "human") return { fields: {}, decision: "keep-human" };

  const currentAlt = asText(existing.alt);

  if (by === AGENT_ASSIGNED_BY) {
    // agent が最後に書いた値から変わっている = 人が直した。
    // 以後 触らないよう出所を human に倒して記録する (alt 自体は書かない)。
    if (currentAlt !== asText(existing.agentAlt)) {
      return { fields: { assignedBy: "human" }, decision: "keep-edited" };
    }
    return {
      fields: {
        alt: candidateAlt,
        assignedBy: AGENT_ASSIGNED_BY,
        agentAlt: candidateAlt,
      },
      decision: "refresh",
    };
  }

  // ここから先は出所不明 (既存の本番データはすべてここに来る)。
  // 説明文が空なら失うものが無いので種を入れる。入っていれば触らない。
  if (currentAlt.trim() === "") return seed();
  return { fields: {}, decision: "keep-unknown" };
}
