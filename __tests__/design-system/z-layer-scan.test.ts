import { describe, expect, it } from "vitest";

import { scanSource } from "./z-layer-scan";

/**
 * 番人そのものの検査 (2026-08-18)
 *
 * 初版の番人は「`fixed`/`sticky` と生 z が同一行にある」形しか見ておらず、
 * 書き方を変えると素通りした。素通りした 3 形をここに固定して、判定が
 * 行単位へ戻ったり、任意値 / inline style の経路が抜けたら落ちるようにする。
 *
 * 同時に「騒音を増やさない」側も固定する。固定面でない z (`relative z-10` /
 * `focus-visible:z-10` / ツールチップの `absolute z-10`) を 1 件でも挙げ始めたら
 * 落ちる。番人が死ぬのは見落としではなく無関係な指摘で埋まるときなので、
 * 検出側と同じ重さで守る。
 */

const detect = (source: string) =>
  scanSource("components/probe.tsx", source).map((offender) => offender.offending);

describe("z-layer scan — 素通りしていた 3 形", () => {
  it("(a) className を複数行に分けても検出する", () => {
    const source = `
      export const Probe = () => (
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 flex",
            "border-t border-border bg-card",
            "z-40",
          )}
        />
      );
    `;
    expect(detect(source)).toEqual(["z-40"]);
  });

  it("(b) 任意値 z-[9999] を検出する", () => {
    const source = `
      export const Probe = () => (
        <div className="fixed inset-0 z-[9999]" />
      );
    `;
    expect(detect(source)).toEqual(["z-[9999]"]);
  });

  it("(c) インライン style の zIndex を検出する", () => {
    const source = `
      export const Probe = () => (
        <div className="fixed bottom-0" style={{ zIndex: 40 }} />
      );
    `;
    expect(detect(source)).toEqual(["style.zIndex=40"]);
  });

  it("style で position ごと指定しても検出する", () => {
    const source = `
      export const Probe = () => (
        <div style={{ position: "fixed", zIndex: 9999 }} />
      );
    `;
    expect(detect(source)).toEqual(["style.zIndex=9999"]);
  });

  it("variant 付きの生 z も検出する", () => {
    const source = `
      export const Probe = () => (
        <header className="sticky top-0 md:z-50" />
      );
    `;
    expect(detect(source)).toEqual(["md:z-50"]);
  });

  it("JSX の外の cva も base と variants をまとめて見る", () => {
    const source = `
      const bar = cva("fixed inset-x-0 bottom-0", {
        variants: { raised: { true: "z-[60]" } },
      });
    `;
    expect(detect(source)).toEqual(["z-[60]"]);
  });
});

describe("z-layer scan — 騒音を出さない", () => {
  it("固定面でない z は挙げない", () => {
    const source = `
      const container = cva("relative z-10 w-full");
      export const Probe = () => (
        <>
          <div className="absolute inset-0 z-10" />
          <button className="focus:z-10 focus-visible:z-10" />
          <span className="[&>*]:focus-visible:z-10" />
        </>
      );
    `;
    expect(detect(source)).toEqual([]);
  });

  it("名前付きレイヤーを使った固定面は挙げない", () => {
    const source = `
      export const Probe = () => (
        <>
          <header className="sticky top-0 z-(--z-sticky)" />
          <div className="fixed inset-0 z-[var(--z-overlay)]" />
          <div className="fixed bottom-0" style={{ zIndex: "var(--z-chat)" }} />
        </>
      );
    `;
    expect(detect(source)).toEqual([]);
  });

  it("固定面でも z を持たなければ挙げない", () => {
    const source = `
      export const Probe = () => (
        <div className="fixed inset-0 bg-black/50" />
      );
    `;
    expect(detect(source)).toEqual([]);
  });

  it("variant 名に fixed を持つだけの部品は挙げない", () => {
    // `position: { fixed: ... }` のような variant 名は固定面の根拠にならない。
    const source = `
      export const Probe = () => (
        <div className="relative z-10" data-variant="fixed" />
      );
    `;
    expect(detect(source)).toEqual([]);
  });
});

describe("z-layer scan — CSS 側", () => {
  it("同じ宣言ブロックの position: fixed と生 z-index を検出する", () => {
    const css = `.dock { position: fixed; inset: 0 auto; z-index: 40; }`;
    expect(scanSource("app/probe.css", css).map((o) => o.offending)).toEqual([
      "z-index: 40",
    ]);
  });

  it("@apply でも検出する", () => {
    const css = `.dock { @apply fixed inset-x-0 z-50; }`;
    expect(scanSource("app/probe.css", css).map((o) => o.offending)).toEqual([
      "@apply z-50",
    ]);
  });

  it("ブリッジ (position を持たない z-index) は挙げない", () => {
    const css = `.z-50 { z-index: var(--z-modal); }`;
    expect(scanSource("app/probe.css", css)).toEqual([]);
  });
});
