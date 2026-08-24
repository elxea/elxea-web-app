import { readingPaletteFor, readingThemePaletteFor } from "../../lib/viz/reading-palette";
import { seasonalPaletteFor, timeOfDayFromHour } from "../../lib/viz/seasonal-palette";
import { themePaletteFor } from "../../lib/viz/theme-palette";
import { hexToOklch } from "../../lib/viz/color";

const tod = timeOfDayFromHour(18);
console.log("hour=18 timeOfDay=", tod);
const fmt = (label: string, cols: string[]) =>
  console.log(label.padEnd(22), cols.map((c) => {
    const o = hexToOklch(c);
    return `${c} L${o.l.toFixed(3)} C${o.c.toFixed(3)} H${Math.round(o.h)}`;
  }).join(" | "));

fmt("seasonal raw(8月)", seasonalPaletteFor(8, tod));
fmt("seasonal reading", readingPaletteFor(8, tod));
for (const t of ["akane", "sui", "sohi"] as const) {
  fmt(`theme raw ${t}`, themePaletteFor(t, tod));
  fmt(`theme reading ${t}`, readingThemePaletteFor(t, tod));
}
