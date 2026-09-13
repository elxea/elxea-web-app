import { describe, it, expect } from "vitest";
import {
  planImageFieldWrite,
  isAgentOverwritable,
  normalizeAssignedBy,
  type ExistingImageField,
} from "../lib/sanity/image-provenance";
import {
  planNotionUpsert,
  upsertFromNotion,
  type SanityDocLike,
  type UpsertCapableClient,
} from "../scripts/lib/sanity-upsert";

/**
 * 「人間がアセットハブ / Studio でやった微調整が、次の同期で消えない」ことの
 * 回帰テスト。
 *
 * 直前の実装 (origin/main 3de76d5) は毎時の同期で
 *   mainImage = { _type:"image", asset, alt: 記事タイトル }
 * を **オブジェクトごと** 書いていたため、
 *   - 人が直した `alt` が記事タイトルで塗り潰される
 *   - Sanity 側にしか無い `hotspot` / `crop` (トリミング位置) が消える
 * という状態だった。守りたい性質は 2 つ:
 *   1. 人が触った形跡があるものを同期が書き換えない
 *   2. エージェントが入れたものはちゃんと更新される (片側だけ直さない)
 */

// ─── Sanity クライアントの最小実装 (ドットパス set を本物と同じ意味で適用) ───

type Doc = Record<string, unknown>;

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Doc = doc;
  for (const key of parts.slice(0, -1)) {
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Doc;
  }
  cur[parts[parts.length - 1]] = value;
}

function hasPath(doc: Doc, path: string): boolean {
  let cur: unknown = doc;
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return false;
    if (!(key in (cur as Doc))) return false;
    cur = (cur as Doc)[key];
  }
  return true;
}

/** createIfNotExists / patch.setIfMissing / patch.set を持つ最小の偽クライアント。 */
function fakeSanity(initial: Doc | null) {
  const store: { doc: Doc | null } = { doc: initial ? structuredClone(initial) : null };

  const client: UpsertCapableClient = {
    async createIfNotExists(skeleton) {
      if (!store.doc) store.doc = { ...skeleton };
      return store.doc;
    },
    patch() {
      const setIfMissingQueue: Record<string, unknown>[] = [];
      const setQueue: Record<string, unknown>[] = [];
      const api = {
        setIfMissing(fields: Record<string, unknown>) {
          setIfMissingQueue.push(fields);
          return api;
        },
        set(fields: Record<string, unknown>) {
          setQueue.push(fields);
          return api;
        },
        async commit() {
          const doc = store.doc as Doc;
          for (const fields of setIfMissingQueue) {
            for (const [path, value] of Object.entries(fields)) {
              if (!hasPath(doc, path)) setPath(doc, path, value);
            }
          }
          for (const fields of setQueue) {
            for (const [path, value] of Object.entries(fields)) {
              setPath(doc, path, value);
            }
          }
          return doc;
        },
      };
      return api as ReturnType<UpsertCapableClient["patch"]>;
    },
  };

  return { client, store };
}

const ASSET = { _type: "reference" as const, _ref: "image-abc123-1600x900-jpg" };

/** 本番と同じ形の記事 doc を組み立てる (mainImage 以外は既存テストと同じ)。 */
function articleDoc(mainImage: Record<string, unknown>): SanityDocLike {
  return {
    _id: "notion-tsushima-oishi-farm-interview",
    _type: "article",
    title: "生産者インタビュー：つしま大石農園",
    slug: { _type: "slug", current: "tsushima-oishi-farm-interview" },
    excerpt: "つしま大石農園を訪ねた。",
    language: "ja",
    mainImage,
  };
}

/** 人間が Sanity 上で調整済みの記事 (トリミング位置 + 直した説明文)。 */
function humanAdjustedArticle(assignedBy: string | undefined): Doc {
  return {
    _id: "notion-tsushima-oishi-farm-interview",
    _type: "article",
    title: "生産者インタビュー：つしま大石農園",
    mainImage: {
      _type: "image",
      asset: ASSET,
      alt: "茶畑に立つ大石さん",
      ...(assignedBy ? { assignedBy } : {}),
      hotspot: { _type: "sanity.imageHotspot", x: 0.31, y: 0.22, height: 0.6, width: 0.6 },
      crop: { _type: "sanity.imageCrop", top: 0.05, bottom: 0.1, left: 0, right: 0.2 },
    },
    // Studio 専用フィールド (2026-08-22 の事故で消えたもの)。
    audioUrl: "https://example.invalid/a.mp3",
  };
}

/** 同期 1 回ぶんを回して、書き込み後の doc を返す。 */
async function runSync(existing: Doc | null, doc: SanityDocLike): Promise<Doc> {
  const { client, store } = fakeSanity(existing);
  await upsertFromNotion(client, doc);
  return store.doc as Doc;
}

// ─── 1. 出所の判定 (asset-hub の語彙と同じ向きに倒れているか) ───

describe("image provenance の判定", () => {
  it("agent と分かっているときだけ上書き可", () => {
    expect(isAgentOverwritable("agent")).toBe(true);
    expect(isAgentOverwritable("エージェント")).toBe(true);
    expect(isAgentOverwritable("human")).toBe(false);
    expect(isAgentOverwritable("unknown")).toBe(false);
    expect(isAgentOverwritable(undefined)).toBe(false);
    expect(isAgentOverwritable("")).toBe(false);
    expect(isAgentOverwritable("  AGENT-ish  ")).toBe(false);
    expect(isAgentOverwritable(42)).toBe(false);
  });

  it("未知の値は agent ではなく unknown に倒れる", () => {
    expect(normalizeAssignedBy("なんらかの文字列")).toBe("unknown");
    expect(normalizeAssignedBy(null)).toBe("unknown");
  });
});

describe("planImageFieldWrite の決定表", () => {
  const title = "新しい記事タイトル";

  it("画像がまだ無ければ説明文の種を入れ、出所を agent で残す", () => {
    const plan = planImageFieldWrite(title, undefined);
    expect(plan.decision).toBe("seed");
    expect(plan.fields).toEqual({ alt: title, assignedBy: "agent", agentAlt: title });
  });

  it("出所が human なら何も書かない", () => {
    const existing: ExistingImageField = {
      exists: true,
      alt: "人が書いた説明",
      assignedBy: "human",
      agentAlt: "エージェントが書いた説明",
    };
    const plan = planImageFieldWrite(title, existing);
    expect(plan.decision).toBe("keep-human");
    expect(plan.fields).toEqual({});
  });

  it("出所不明 (既存データ) は説明文が入っていれば触らない", () => {
    const plan = planImageFieldWrite(title, {
      exists: true,
      alt: "既存の説明",
    });
    expect(plan.decision).toBe("keep-unknown");
    expect(plan.fields).toEqual({});
  });

  it("出所不明でも説明文が空なら種を入れる (失うものが無い)", () => {
    const plan = planImageFieldWrite(title, { exists: true, alt: "   " });
    expect(plan.decision).toBe("seed");
    expect(plan.fields.alt).toBe(title);
  });

  it("出所が agent で、書いた値のまま = エージェント所有なので更新する", () => {
    const plan = planImageFieldWrite(title, {
      exists: true,
      alt: "前のタイトル",
      assignedBy: "agent",
      agentAlt: "前のタイトル",
    });
    expect(plan.decision).toBe("refresh");
    expect(plan.fields).toEqual({ alt: title, assignedBy: "agent", agentAlt: title });
  });

  it("出所が agent でも 人が直した形跡があれば触らず出所を human に倒す", () => {
    const plan = planImageFieldWrite(title, {
      exists: true,
      alt: "人が直した説明",
      assignedBy: "agent",
      agentAlt: "前のタイトル",
    });
    expect(plan.decision).toBe("keep-edited");
    expect(plan.fields).toEqual({ assignedBy: "human" });
    expect(plan.fields.alt).toBeUndefined();
  });
});

// ─── 2. 書き込み経路 (トリミング位置が消えないか) ───

describe("同期の書き込み (upsertFromNotion)", () => {
  it("画像はドットパスに展開され hotspot / crop は書き込み対象に入らない", () => {
    const plan = planNotionUpsert(
      articleDoc({ _type: "image", asset: ASSET, alt: "説明", assignedBy: "agent" })
    );
    const touched = [...Object.keys(plan.set), ...Object.keys(plan.setIfMissing)];

    expect(plan.set["mainImage.asset"]).toEqual(ASSET);
    expect(plan.set["mainImage.alt"]).toBe("説明");
    expect(plan.setIfMissing.mainImage).toEqual({ _type: "image" });
    // 画像オブジェクトを丸ごと置き換えていない (= これが hotspot を消していた)。
    // setIfMissing の `mainImage` は「無ければ器だけ作る」なので既存は壊さない。
    expect(Object.keys(plan.set)).not.toContain("mainImage");
    expect(touched.some((k) => k.includes("hotspot") || k.includes("crop"))).toBe(false);
  });

  it("人が調整したトリミング位置と説明文が同期後も残る", async () => {
    const existing = humanAdjustedArticle("human");
    // 同期は「出所 human なので alt を書かない」= asset だけ載せた doc を作る
    const after = await runSync(existing, articleDoc({ _type: "image", asset: ASSET }));
    const img = after.mainImage as Doc;

    expect(img.alt).toBe("茶畑に立つ大石さん");
    expect(img.hotspot).toEqual(existing.mainImage && (existing.mainImage as Doc).hotspot);
    expect(img.crop).toEqual(existing.mainImage && (existing.mainImage as Doc).crop);
    // 2026-08-22 の事故の非回帰も同時に確認する
    expect(after.audioUrl).toBe("https://example.invalid/a.mp3");
  });

  it("出所不明の既存データも説明文とトリミングが残る", async () => {
    const existing = humanAdjustedArticle(undefined);
    const after = await runSync(existing, articleDoc({ _type: "image", asset: ASSET }));
    const img = after.mainImage as Doc;
    expect(img.alt).toBe("茶畑に立つ大石さん");
    expect(img.hotspot).toBeDefined();
  });

  it("エージェントが入れたものは更新される (片側だけ直していない)", async () => {
    const existing: Doc = {
      _id: "notion-tsushima-oishi-farm-interview",
      _type: "article",
      mainImage: {
        _type: "image",
        asset: { _type: "reference", _ref: "image-old" },
        alt: "前のタイトル",
        assignedBy: "agent",
        agentAlt: "前のタイトル",
        hotspot: { _type: "sanity.imageHotspot", x: 0.5, y: 0.5, height: 1, width: 1 },
      },
    };
    const plan = planImageFieldWrite("新しい記事タイトル", {
      exists: true,
      alt: "前のタイトル",
      assignedBy: "agent",
      agentAlt: "前のタイトル",
    });
    const after = await runSync(
      existing,
      articleDoc({ _type: "image", asset: ASSET, ...plan.fields })
    );
    const img = after.mainImage as Doc;

    expect(img.alt).toBe("新しい記事タイトル");
    expect(img.agentAlt).toBe("新しい記事タイトル");
    expect(img.asset).toEqual(ASSET);
    // 更新される側でもトリミング位置は保持する (差し替えは人がハブでやる前提)
    expect(img.hotspot).toBeDefined();
  });

  it("新規記事には説明文と出所が入る", async () => {
    const plan = planImageFieldWrite("新しい記事タイトル", undefined);
    const after = await runSync(
      null,
      articleDoc({ _type: "image", asset: ASSET, ...plan.fields })
    );
    const img = after.mainImage as Doc;
    expect(img._type).toBe("image");
    expect(img.alt).toBe("新しい記事タイトル");
    expect(img.assignedBy).toBe("agent");
  });
});

// ─── 3. ミューテーション (保護を壊すと落ちるか) ───

describe("ミューテーション: 保護を外すとこのテストは落ちる", () => {
  it("画像を丸ごと set する旧実装に戻すと トリミング位置が消える", async () => {
    const existing = humanAdjustedArticle("human");
    const { client, store } = fakeSanity(existing);
    // 旧実装 (origin/main 3de76d5) と同じ書き方を直接再現する
    await client.createIfNotExists({ _id: existing._id as string, _type: "article" });
    await client
      .patch(existing._id as string)
      .set({ mainImage: { _type: "image", asset: ASSET, alt: "記事タイトル" } })
      .commit();

    const img = (store.doc as Doc).mainImage as Doc;
    expect(img.hotspot).toBeUndefined(); // 消える = 直す前の壊れた挙動
    expect(img.alt).toBe("記事タイトル"); // 人の説明文が塗り潰される
  });

  it("『unknown も agent 扱い』に緩めると 人の説明文が上書きされる", () => {
    // 緩めた判定 (unknown を通してしまう版)
    const loose = (value: unknown): boolean =>
      normalizeAssignedBy(value) !== "human";
    const existing: ExistingImageField = { exists: true, alt: "人が書いた説明" };

    expect(loose(existing.assignedBy)).toBe(true); // 緩い版は書いてよいと判断する
    expect(isAgentOverwritable(existing.assignedBy)).toBe(false); // 本物は止める
    expect(planImageFieldWrite("記事タイトル", existing).fields.alt).toBeUndefined();
  });

  it("agentAlt との突き合わせを外すと 人が直した説明文が更新対象になる", () => {
    const existing: ExistingImageField = {
      exists: true,
      alt: "人が直した説明",
      assignedBy: "agent",
      agentAlt: "前のタイトル",
    };
    // 突き合わせを外した版 = 出所だけ見る
    const mutantWouldWrite = isAgentOverwritable(existing.assignedBy);
    expect(mutantWouldWrite).toBe(true); // 外すと書いてしまう
    expect(planImageFieldWrite("新しいタイトル", existing).fields.alt).toBeUndefined();
  });
});
