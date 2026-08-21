import { seasonalPaletteFor, TIMES_OF_DAY } from "../../lib/viz/seasonal-palette";
import { hexToOklch } from "../../lib/viz/color";
for (const m of [8, 10, 12, 4]) {
  for (const t of TIMES_OF_DAY) {
    console.log(m, t, JSON.stringify(seasonalPaletteFor(m, t)));
  }
}
let maxC = 0, minL = 1, maxL = 0;
for (let m = 1; m <= 12; m++) for (const t of TIMES_OF_DAY) for (const hex of seasonalPaletteFor(m, t)) {
  const { l, c } = hexToOklch(hex);
  maxC = Math.max(maxC, c); minL = Math.min(minL, l); maxL = Math.max(maxL, l);
}
console.log("maxC", maxC.toFixed(4), "L range", minL.toFixed(3), maxL.toFixed(3));
