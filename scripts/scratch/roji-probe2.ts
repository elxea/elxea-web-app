import { seasonalPaletteFor, TIMES_OF_DAY } from "@/lib/viz/seasonal-palette";
import { hexToOklch, oklchToHex } from "@/lib/viz/color";

const PAPER = oklchToHex({ l: 0.933, c: 0.012, h: 96.4 });
const TEXT = oklchToHex({ l: 0.482, c: 0.005, h: 271.3 });
const rgb = (hex: string) => { const h = hex.replace("#", ""); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); };
const lum = (hex: string) => { const [r,g,b] = rgb(hex).map(v => { const s=v/255; return s<=0.03928? s/12.92 : Math.pow((s+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio = (a: string, b: string) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const over = (fg: string, bg: string, a: number) => { const f=rgb(fg), b=rgb(bg); return "#"+f.map((v,i)=>Math.round(v*a+b[i]*(1-a)).toString(16).padStart(2,"0")).join(""); };

function anchored(colors: string[], floorL: number, ceilL: number, chromaScale: number) {
  const ok = colors.map(hexToOklch);
  const lo = Math.min(...ok.map(c => c.l));
  const hi = Math.max(...ok.map(c => c.l));
  const span = hi - lo;
  return ok.map(c => oklchToHex({
    l: span < 1e-4 ? (floorL + ceilL) / 2 : floorL + (ceilL - floorL) * ((c.l - lo) / span),
    c: c.c * chromaScale,
    h: c.h,
  }));
}

const base = ratio(TEXT, PAPER);
console.log("baseline", base.toFixed(3));
for (const [fl, cl, cs] of [[0.80,0.96,0.9],[0.82,0.96,0.9],[0.78,0.95,0.85],[0.84,0.965,1.0]] as const) {
  for (const alpha of [0.55, 0.7, 1]) {
    let worst = Infinity, at = "";
    for (let m=1;m<=12;m++) for (const t of TIMES_OF_DAY) {
      for (const c of anchored(seasonalPaletteFor(m,t), fl, cl, cs)) {
        const r = ratio(TEXT, over(c, PAPER, alpha));
        if (r<worst){worst=r; at=`${m}/${t}/${c}`;}
      }
    }
    console.log(`floor=${fl} ceil=${cl} cs=${cs} alpha=${alpha} -> worst=${worst.toFixed(3)} keep=${(worst/base*100).toFixed(1)}% at ${at}`);
  }
}
// how distinguishable do the 4 colors stay?
const ex = anchored(seasonalPaletteFor(12, "night"), 0.80, 0.96, 0.9);
console.log("12/night raw ", seasonalPaletteFor(12,"night").join(" "));
console.log("12/night anch", ex.join(" "));
console.log("8/day raw ", seasonalPaletteFor(8,"day").join(" "));
console.log("8/day anch", anchored(seasonalPaletteFor(8,"day"),0.80,0.96,0.9).join(" "));
