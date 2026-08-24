import { hexToOklch } from "@/lib/viz/color";
import { seasonalPaletteFor, seasonalRolesFor, TIMES_OF_DAY } from "@/lib/viz/seasonal-palette";
for (const m of [8, 10, 12, 1, 5, 9]) {
  for (const t of TIMES_OF_DAY) {
    const p = seasonalPaletteFor(m, t);
    const r = seasonalRolesFor(m, t);
    const parts = p.map((hex, i) => {
      const o = hexToOklch(hex);
      return `${r[i].padEnd(6)} ${hex} L=${o.l.toFixed(3)} C=${o.c.toFixed(3)} h=${o.h.toFixed(0).padStart(3)}`;
    });
    const ls = p.map((h) => hexToOklch(h).l);
    const cs = p.map((h) => hexToOklch(h).c);
    console.log(`m${String(m).padStart(2)} ${t.padEnd(7)} spreadL=${(Math.max(...ls)-Math.min(...ls)).toFixed(3)} minC=${Math.min(...cs).toFixed(3)} maxC=${Math.max(...cs).toFixed(3)}`);
    for (const s of parts) console.log("        " + s);
  }
}
