/**
 * 宣言 (public/image-slots.inventory.json の `surfaces`) の比と、描画のコードが Sanity の画像を
 * 切り抜く幅と高さ (urlFor(...).width().height()) が同じかを見る。
 *
 * なぜ要るか: Asset hub (elxea-asset-hub lib/sanity-exit.ts) は宣言の `surfaces[0].ratio` の窓で
 * 位置 (focal) を Sanity の hotspot に写す。宣言の比と描画の比がずれると、サイトの切り抜きが
 * Asset hub の見本と黙って食い違う。比の正本は lib/sanity-image-surfaces.ts の 1 か所で、
 * 描画のコードもジェネレータもそこを読む。ここは「宣言の数字」と「描画のコードの数字」を
 * それぞれの実物から読んで比べる (どちらかを書き換えると赤になる)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import * as surfacesModule from "@/lib/sanity-image-surfaces";
import { SANITY_SLOT_SURFACES } from "@/lib/sanity-image-surfaces";
import type { RenderSize } from "@/lib/sanity-image-surfaces";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface InventorySlot {
  id: string;
  surfaces?: { id: string; ratio: { width: number; height: number } }[];
}

const inventory = JSON.parse(
  readFileSync(path.join(ROOT, "public", "image-slots.inventory.json"), "utf8"),
) as { slots: InventorySlot[] };

/** 枠ごとの主な表示 (surfaces[0]) を切り抜く描画のコードの場所。 */
const RENDER_SITES: {
  slotId: string;
  file: string;
  call: string;
  /** 枠の画像がその描画のコードに届く経路 (別ファイルを通るとき)。 */
  via?: { file: string; text: string }[];
}[] = [
  {
    slotId: "sanity:teaMenu:photo",
    file: "app/[locale]/(reading)/tea-menu/page.tsx",
    call: "urlFor(item.photo)",
  },
  {
    slotId: "sanity:playlist:albumImage",
    file: "components/journal/article-card.tsx",
    call: "urlFor(image)",
    via: [
      { file: "app/[locale]/(reading)/playlists/page.tsx", text: "thumbnail: pl.albumImage" },
      { file: "app/[locale]/(reading)/playlists/page.tsx", text: "<ArticleCard" },
    ],
  },
];

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 描画のコードの `.width(<式>)` / `.height(<式>)` の式を数にする (数字か、正本の定数の .width / .height)。 */
function resolveSize(expr: string): number {
  if (/^\d+$/.test(expr)) return Number(expr);
  const ref = /^([A-Z][A-Z0-9_]*)\.(width|height)$/.exec(expr);
  const size = ref
    ? ((surfacesModule as Record<string, unknown>)[ref[1]] as RenderSize | undefined)
    : undefined;
  if (!ref || !size) throw new Error(`描画のコードの幅・高さを読めない: ${expr}`);
  return size[ref[2] as "width" | "height"];
}

/** 描画のコードで、その呼び出しが切り抜く幅と高さ。呼び出しはファイルにちょうど 1 つ。 */
function renderSizeAt(file: string, call: string): RenderSize {
  const re = new RegExp(
    `${escape(call)}\\s*\\.width\\(\\s*([^()]+?)\\s*\\)\\s*\\.height\\(\\s*([^()]+?)\\s*\\)`,
    "g",
  );
  const found = [...read(file).matchAll(re)];
  expect(found, `${file} の ${call}.width().height()`).toHaveLength(1);
  return { width: resolveSize(found[0][1]), height: resolveSize(found[0][2]) };
}

const sameRatio = (a: RenderSize, b: RenderSize) => a.width * b.height === b.width * a.height;

describe("image-slots の surfaces (主な表示の比)", () => {
  it("宣言の surfaces は正本 (lib/sanity-image-surfaces.ts) と同じ (pnpm generate:image-slots 済み)", () => {
    for (const slot of inventory.slots) {
      expect(slot.surfaces ?? null, slot.id).toEqual(
        (SANITY_SLOT_SURFACES[slot.id] as unknown) ?? null,
      );
    }
  });

  it("surfaces を持つ枠には、主な表示を切り抜く描画のコードの場所が書いてある", () => {
    const declared = inventory.slots.filter((s) => s.surfaces).map((s) => s.id).sort();
    expect(declared).toEqual(RENDER_SITES.map((r) => r.slotId).sort());
  });

  for (const site of RENDER_SITES) {
    it(`${site.slotId}: 宣言の surfaces[0] の比 = 描画のコード (${site.file}) の幅:高さ`, () => {
      const declared = inventory.slots.find((s) => s.id === site.slotId)?.surfaces?.[0]?.ratio;
      expect(declared, `${site.slotId} の surfaces[0].ratio`).toBeDefined();
      const rendered = renderSizeAt(site.file, site.call);
      expect(
        sameRatio(declared!, rendered),
        `宣言 ${declared!.width}:${declared!.height} / 描画 ${rendered.width}:${rendered.height}`,
      ).toBe(true);
      for (const v of site.via ?? []) {
        expect(read(v.file), `${v.file} に ${v.text}`).toContain(v.text);
      }
    });
  }
});
