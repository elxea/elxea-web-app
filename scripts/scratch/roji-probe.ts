import { seasonalPaletteFor, TIMES_OF_DAY } from "@/lib/viz/seasonal-palette";
import { oklchToHex } from "@/lib/viz/color";

const PAPER = oklchToHex({ l: 0.933, c: 0.012, h: 96.4 });
const TEXT = oklchToHex({ l: 0.482, c: 0.005, h: 271.3 });

function rgb(hex: string) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function over(fg: string, bg: string, alpha: number) {
  const f = rgb(fg), b = rgb(bg);
  const m = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const base = ratio(TEXT, PAPER);
console.log("paper", PAPER, "text", TEXT, "baseline contrast", base.toFixed(3));

for (const alpha of [0.2, 0.25, 0.3, 0.34, 0.4, 0.5, 0.6, 0.75, 1]) {
  let worst = Infinity, worstAt = "";
  for (let m = 1; m <= 12; m++) {
    for (const t of TIMES_OF_DAY) {
      for (const c of seasonalPaletteFor(m, t)) {
        const r = ratio(TEXT, over(c, PAPER, alpha));
        if (r < worst) { worst = r; worstAt = `${m}/${t}/${c}`; }
      }
    }
  }
  console.log(`alpha=${alpha}  worst=${worst.toFixed(3)}  keep=${(worst / base * 100).toFixed(1)}%  at ${worstAt}`);
}
