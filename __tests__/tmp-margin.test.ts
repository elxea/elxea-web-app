import { describe, it } from "vitest";

import { cameraForFraming, worldToScreen } from "@/components/viz/profile/camera";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import { profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import { SyntheticSource } from "@/lib/profile/synthetic";
import type { ProfileFacet, ProfileFieldResponse, TeaCategory } from "@/lib/profile/contract";

const CASES: Array<[ProfileFacet, TeaCategory | undefined]> = [
  ["tea", "green"],
  ["tea", "red"],
  ["tea", "oolong"],
  ["reading", undefined],
  ["event", undefined],
];

function visibleBounds(field: ProfileFieldResponse, floor: number) {
  const grid = field.grid!;
  const u8 = decodeU8FromBase64(grid.data);
  const [x0, y0, x1, y1] = field.bbox;
  const cw = (x1 - x0) / grid.w;
  const ch = (y1 - y0) / grid.h;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      if ((u8[j * grid.w + i] ?? 0) < floor) continue;
      const cx = x0 + (i + 0.5) * cw;
      const cy = y0 + (j + 0.5) * ch;
      if (cx < mnx) mnx = cx;
      if (cx > mxx) mxx = cx;
      if (cy < mny) mny = cy;
      if (cy > mxy) mxy = cy;
    }
  }
  return { mnx, mny, mxx, mxy };
}

describe("margin probe", () => {
  it("prints painted margins per DENSITY_FLOOR candidate", async () => {
    const rows: string[] = [];
    for (const [facet, category] of CASES) {
      for (const z of [0, 1, 2]) {
        const source = new SyntheticSource();
        const field = await source.getField({ facet, category, z });
        const words = await source.getWords({
          facet,
          category,
          bbox: profileFieldBbox(facet),
          z,
          userKey: null,
        });
        const framing = sceneFraming({ self: null, field, words }, facet);
        const view = { w: 510, h: 638 };
        const cam = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z });
        // 実際に見える塗り (wash が紙から見て取れる値 53、micro の最外等値線 41)
        for (const floor of [26, 41, 53, 70]) {
          const b = visibleBounds(field, floor);
          const top = worldToScreen(cam, b.mnx, b.mny, view.w, view.h);
          const bottom = worldToScreen(cam, b.mxx, b.mxy, view.w, view.h);
          const mt = top.y;
          const mb = view.h - bottom.y;
          const ml = top.x;
          const mr = view.w - bottom.x;
          rows.push(
            `MARGIN ${facet}/${category ?? "-"} z=${z} floor=${floor} top=${mt.toFixed(0)} bottom=${mb.toFixed(0)} ratio=${(Math.max(mt, mb) / Math.max(1, Math.min(mt, mb))).toFixed(2)} left=${ml.toFixed(0)} right=${mr.toFixed(0)}`,
          );
        }
      }
    }
    console.log("\n" + rows.join("\n"));
  });
});
