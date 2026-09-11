import { describe, it, expect } from "vitest";

import {
  normalizeNode,
  walkSection,
  diffSnapshots,
  stableStringify,
  extractRoute,
  buildSnapshot,
  type FigmaNode,
  type NormalizedNode,
  type ProposalFetch,
} from "@/scripts/design-system/figma-snapshot-lib";

/**
 * 施策② figma-snapshot / change-manifest の決定論・fail-loud 単体テスト。
 * 実 API は叩かず fixture (nodes API が返す subtree の形) で検証する。
 */

const box = (x: number, y: number, w: number, h: number) => ({
  x,
  y,
  width: w,
  height: h,
});

const solid = (r: number, g: number, b: number) => ({
  type: "SOLID",
  color: { r, g, b, a: 1 },
});

describe("normalizeNode: resolved 値の決定論正規化", () => {
  it("resolved paint color を保存する (binding 名だけにしない = C4-i)", () => {
    const n: FigmaNode = {
      id: "1:1",
      name: "Btn",
      type: "INSTANCE",
      componentId: "9:9",
      absoluteBoundingBox: box(10.004, 20.006, 100, 44),
      fills: [solid(0.1234567, 0.5, 0.9)],
    };
    const r = normalizeNode(n, "@/ja/x");
    expect(r.id).toBe("1:1");
    expect(r.route).toBe("@/ja/x");
    expect(r.props.componentId).toBe("9:9");
    // 座標は 2 桁丸め
    expect(r.props.box).toEqual({ x: 10, y: 20.01, w: 100, h: 44 });
    // 色は 4 桁丸めで resolved 値を保持
    const fills = r.props.fills as Array<Record<string, unknown>>;
    expect((fills[0].color as Record<string, number>).r).toBe(0.1235);
    expect(fills[0].visible).toBe(true);
  });

  it("既定値 (opacity=1 / visible=true) は props に含めない (欠落と null の区別)", () => {
    const n: FigmaNode = { id: "1:2", name: "F", type: "FRAME", opacity: 1, visible: true };
    const r = normalizeNode(n, "@/ja/x");
    expect(r.props.opacity).toBeUndefined();
    expect(r.props.visible).toBeUndefined();
  });

  it("visible=false は明示記録する", () => {
    const n: FigmaNode = { id: "1:3", name: "F", type: "FRAME", visible: false };
    expect(normalizeNode(n, "@/ja/x").props.visible).toBe(false);
  });

  it("TEXT の characters と textStyle を捕捉する", () => {
    const n: FigmaNode = {
      id: "1:4",
      name: "T",
      type: "TEXT",
      characters: "こんにちは",
      style: { fontFamily: "Inter", fontSize: 16.004, fontWeight: 600 },
    };
    const r = normalizeNode(n, "@/ja/x");
    expect(r.props.characters).toBe("こんにちは");
    expect(r.props.textStyle).toEqual({ fontFamily: "Inter", fontSize: 16, fontWeight: 600 });
  });
});

describe("walkSection: 全走査・上限なし (silent truncation 禁止 / C4)", () => {
  it("INSTANCE 内部にも降下する (main→instance 波及検知の土台 / C4-ii)", () => {
    const root: FigmaNode = {
      id: "s:0",
      name: "@/ja/x sec",
      type: "SECTION",
      children: [
        {
          id: "i:1",
          name: "Card",
          type: "INSTANCE",
          children: [{ id: "t:1", name: "label", type: "TEXT", characters: "A" }],
        },
      ],
    };
    const out: Record<string, NormalizedNode> = {};
    walkSection(root, "@/ja/x", out);
    // section + instance + instance 内部 TEXT = 3 (内部を落とさない)
    expect(Object.keys(out).sort()).toEqual(["i:1", "s:0", "t:1"]);
  });
});

describe("stableStringify: キー順に依存しない安定出力", () => {
  it("キー順が違っても同一文字列になる", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe("diffSnapshots: added / removed / modified の決定論", () => {
  const baseNode = (id: string, chars: string): NormalizedNode => ({
    id,
    route: "@/ja/x",
    name: "T",
    type: "TEXT",
    props: { characters: chars },
  });

  it("同一 snapshot は diff=0 (冪等 → 2 回目実行で 0 の根拠)", () => {
    const snap = { "1:1": baseNode("1:1", "A"), "1:2": baseNode("1:2", "B") };
    const d = diffSnapshots(snap, snap);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.modified).toHaveLength(0);
    expect(d.unchanged).toBe(2);
  });

  it("1 node の値変更を modified + changed_fields で検出 (人工変更テストの根拠)", () => {
    const baseline = { "1:1": baseNode("1:1", "A") };
    const live = { "1:1": baseNode("1:1", "CHANGED") };
    const d = diffSnapshots(baseline, live);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0].id).toBe("1:1");
    expect(d.modified[0].changed_fields).toEqual([
      { path: "props.characters", from: "A", to: "CHANGED" },
    ]);
  });

  it("added / removed を id 差で検出", () => {
    const baseline = { "1:1": baseNode("1:1", "A") };
    const live = { "1:2": baseNode("1:2", "B") };
    const d = diffSnapshots(baseline, live);
    expect(d.added.map((n) => n.id)).toEqual(["1:2"]);
    expect(d.removed.map((n) => n.id)).toEqual(["1:1"]);
  });

  it("name / route の変更も changed_fields に載る", () => {
    const baseline = { "1:1": baseNode("1:1", "A") };
    const live = { "1:1": { ...baseNode("1:1", "A"), name: "T2", route: "@/ja/y" } };
    const d = diffSnapshots(baseline, live);
    const paths = d.modified[0].changed_fields.map((c) => c.path).sort();
    expect(paths).toEqual(["name", "route"]);
  });
});

describe("buildSnapshot: 除外 (対象外) の明示計上", () => {
  it("@/<route> でない兄弟 section を excluded に計上する (silent truncation 禁止)", () => {
    const fetched: ProposalFetch = {
      fileName: "F",
      fileLastModified: "2026-07-13T00:00:00Z",
      page: { id: "p", name: "Proposals" },
      routeSections: [{ id: "s:1", route: "@/ja/x" }],
      sectionsWithoutRoute: [{ id: "s:2", name: "表紙 Cover" }],
      sectionDocs: {
        "s:1": {
          id: "s:1",
          name: "@/ja/x",
          type: "SECTION",
          children: [{ id: "t:1", name: "t", type: "TEXT", characters: "A" }],
        },
      },
    };
    const snap = buildSnapshot(fetched, "FILEKEY");
    expect(snap.counts.excluded_sections).toBe(1);
    expect(snap.excluded.sections_without_route).toEqual([
      { id: "s:2", name: "表紙 Cover" },
    ]);
    expect(snap.counts.nodes).toBe(2); // section + text
  });
});

describe("extractRoute: 施策① と同一挙動 (回帰防止)", () => {
  it("末尾 route を抽出", () => {
    expect(extractRoute("商品一覧 — PC/SP @/ja/products")).toBe("@/ja/products");
  });
  it("route 無しは null", () => {
    expect(extractRoute("表紙 Cover")).toBeNull();
  });
});
