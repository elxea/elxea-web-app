import { seasonalPaletteFor } from "../../lib/viz/seasonal-palette";
import { hexToOklch } from "../../lib/viz/color";
const PIVOT = 0.7;
for (const [m, t] of [[8,"morning"],[8,"night"],[10,"day"],[12,"night"],[9,"dusk"]] as const) {
  const colors = seasonalPaletteFor(m, t as never);
  const measured = colors.map((hex) => ({ hex, ...hexToOklch(hex) }));
  const mean = measured.reduce((s, x) => s + x.l, 0) / measured.length;
  const lightGround = mean >= PIVOT;
  let g = 0;
  measured.forEach((x, i) => { if (i && (lightGround ? x.l > measured[g].l : x.l < measured[g].l)) g = i; });
  let a = -1;
  measured.forEach((x, i) => { if (i !== g && (a === -1 || x.c > measured[a].c)) a = i; });
  console.log(m, t, "mean L", mean.toFixed(3), measured.map((x, i) => `${x.hex}${i===g?"[ground]":i===a?"[ACCENT]":"[mid]"} L${x.l.toFixed(2)} C${x.c.toFixed(3)}`).join("  "));
}
