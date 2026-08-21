import { seasonalPaletteFor, TIMES_OF_DAY } from "@/lib/viz/seasonal-palette";
import { hexToOklch, oklchToHex } from "@/lib/viz/color";
const PAPER = oklchToHex({ l: 0.933, c: 0.012, h: 96.4 });
const TEXT = oklchToHex({ l: 0.482, c: 0.005, h: 271.3 });
const rgb = (h0: string) => { const h = h0.replace("#",""); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lum = (hex: string) => { const [r,g,b]=rgb(hex).map(v=>{const s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);}); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio=(a:string,b:string)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const over=(f0:string,b0:string,a:number)=>{const f=rgb(f0),b=rgb(b0);return "#"+f.map((v,i)=>Math.round(v*a+b[i]*(1-a)).toString(16).padStart(2,"0")).join("");};
function anchored(colors: string[], fl: number, cl: number, cs: number) {
  const ok = colors.map(hexToOklch);
  const lo=Math.min(...ok.map(c=>c.l)), hi=Math.max(...ok.map(c=>c.l)), span=hi-lo;
  return ok.map(c=>oklchToHex({ l: span<1e-4?(fl+cl)/2:fl+(cl-fl)*((c.l-lo)/span), c: c.c*cs, h: c.h }));
}
const base = ratio(TEXT, PAPER);
let best: any = null;
for (const fl of [0.84,0.86,0.87,0.88,0.89,0.90]) for (const cl of [0.955,0.965,0.975]) for (const cs of [0.6,0.7,0.8,0.9,1.0]) for (const alpha of [0.45,0.5,0.55,0.6,0.7,0.8,0.9,1.0]) {
  if (cl <= fl) continue;
  let worst=Infinity;
  for (let m=1;m<=12;m++) for (const t of TIMES_OF_DAY) for (const c of anchored(seasonalPaletteFor(m,t),fl,cl,cs)) {
    const r=ratio(TEXT, over(c,PAPER,alpha)); if(r<worst) worst=r;
  }
  if (worst >= 4.5) {
    // presence: どれだけ色が出ているか = 不透明度 x 明度幅 x 彩度倍率
    const presence = alpha * (cl-fl) * cs;
    if (!best || presence > best.presence) best = { fl, cl, cs, alpha, worst, presence };
  }
}
console.log("baseline", base.toFixed(3), "best AA config:", best);
// 選定候補を数点表示
for (const cfg of [[0.86,0.965,0.9,0.6],[0.88,0.97,1.0,0.7],[0.87,0.965,0.85,0.65]] as const) {
  const [fl,cl,cs,alpha]=cfg; let worst=Infinity, at="";
  for (let m=1;m<=12;m++) for (const t of TIMES_OF_DAY) for (const c of anchored(seasonalPaletteFor(m,t),fl,cl,cs)) {
    const r=ratio(TEXT,over(c,PAPER,alpha)); if(r<worst){worst=r;at=`${m}/${t}/${c}`;}
  }
  console.log(cfg.join("/"), "worst", worst.toFixed(3), "keep", (worst/base*100).toFixed(1)+"%", at);
}
