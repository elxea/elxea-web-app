/**
 * LOW-FIDELITY HOME LAYOUT PROPOSAL — elxea web app
 * --------------------------------------------------
 * Status: PROPOSAL ONLY. Not wired to Sanity / Shopify. Standalone render.
 * Route:  /[locale]/proposal-home
 *
 * Purpose: convey the *intent* of a re-built Top page at low fidelity.
 *   - Real DS tokens (color/typography/spacing/radius from tokens/base.json)
 * *   - Real shadcn primitives (Button, Badge, AspectRatio)
 *   - Grey placeholder blocks stand in for photography / product imagery
 *   - Placeholder copy in elxea External Voice register
 *
 * Aesthetic direction: "Editorial Terroir" — quiet, gallery-like editorial
 *   layout built on 余白 (negative space), asymmetry, and a warm earth palette.
 *   See accompanying Devlog for the full rationale + dial values.
 *
 * Dials applied here (low-fi expression):
 *   VARIANCE = mid-high (deliberate asymmetry, varied section rhythm)
 *   MOTION   = low       (no animation in low-fi; reveal-on-scroll noted only)
 *   DENSITY  = low        (generous whitespace, large type, few elements/screen)
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AspectRatio } from "@/components/ui/aspect-ratio";

function Plate({
  className = "",
  label,
  ratio,
}: {
  className?: string;
  label?: string;
  ratio?: number;
}) {
  const inner = (
    <div
      className={`flex h-full w-full items-center justify-center bg-muted text-muted-foreground/60 ${className}`}
    >
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.25em]">{label}</span>
      ) : null}
    </div>
  );
  if (ratio) {
    return <AspectRatio ratio={ratio}>{inner}</AspectRatio>;
  }
  return inner;
}

function Overline({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
      {children}
    </p>
  );
}

export default function ProposalHomePage() {
  return (
    <main className="bg-background text-foreground">
      {/* 1. HERO — full-bleed editorial, asymmetric lower-left copy */}
      <section className="relative min-h-[88vh] w-full">
        <Plate label="Hero KV — 木漏れ日 / 産地の光" className="absolute inset-0" />
        <div className="absolute inset-0 bg-overlay" />
        <div className="relative flex min-h-[88vh] flex-col justify-end px-6 pb-20 md:px-16 md:pb-28">
          <div className="max-w-xl">
            <Overline>Single Origin Tea</Overline>
            <h1 className="mt-6 text-overlay-foreground" style={{ fontWeight: 300 }}>
              Tea for Creativity.
            </h1>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-overlay-foreground-muted">
              日常の中にきらめきを感じられる一杯を。日本各地の小規模茶農家が育てた、
              シングルオリジン茶葉のセレクション。
            </p>
            <div className="mt-10 flex gap-4">
              <Button
                variant="outline"
                className="border-overlay-border bg-transparent text-overlay-foreground hover:bg-overlay-foreground hover:text-foreground"
              >
                Shop Tea
              </Button>
              <Button variant="link" className="px-0 text-overlay-foreground-muted">
                Our Story →
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. INTRO / MANIFESTO — wide whitespace band, single statement */}
      <section className="mx-auto max-w-3xl px-6 py-32 text-center">
        <p className="text-2xl leading-relaxed md:text-3xl" style={{ fontWeight: 300 }}>
          一杯を通じた、一期一会の出会い。
          <br />
          産地ごとのテロワールが、あなたの喫茶時間を彩る。
        </p>
      </section>

      {/* 3. FEATURED COLLECTION — asymmetric 5/7 editorial split */}
      <section className="px-6 py-12 md:px-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5">
            <Plate label="Featured — 茶葉クローズ" ratio={0.75} />
            <Overline>
              <span className="mt-6 inline-block">Featured Selection</span>
            </Overline>
            <h2 className="mt-2" style={{ fontWeight: 300 }}>
              Spring Single Origins
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              この春に届いた、限定のシングルオリジン。生産者の名前とともに。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6 md:col-span-7">
            {[
              { region: "Kyoto · 宇治", name: "Sencha — Asahi" },
              { region: "Kagoshima", name: "Kamairicha" },
              { region: "Shizuoka", name: "Wakoucha" },
              { region: "Fukuoka · 八女", name: "Gyokuro" },
            ].map((p) => (
              <div key={p.name} className="group">
                <Plate label="Product" ratio={0.8} />
                <div className="mt-4 text-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {p.region}
                  </p>
                  <h3 className="mt-1 text-sm leading-relaxed" style={{ fontWeight: 400 }}>
                    {p.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">¥1,800</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex justify-center">
          <Button variant="link" className="text-muted-foreground">
            View all products →
          </Button>
        </div>
      </section>

      {/* 4. CATEGORY / DISCOVER — horizontal rail, rounded tiles */}
      <section className="py-24">
        <div className="mb-12 px-6 text-center md:px-16">
          <Overline>Discover by</Overline>
          <h2 className="mt-3" style={{ fontWeight: 300 }}>
            Type · Region · Mood
          </h2>
        </div>
        <div className="flex gap-6 overflow-x-auto px-6 pb-2 md:px-16">
          {["Green", "Black", "Oolong", "Roasted", "Blend", "Caffeine-free"].map((c) => (
            <div key={c} className="w-44 shrink-0">
              <div className="overflow-hidden rounded-2xl">
                <Plate label={c} ratio={1} />
              </div>
              <p className="mt-3 text-center text-sm">{c}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. STORY / TERROIR — full-bleed band with overlapping offset card */}
      <section className="relative w-full">
        <Plate label="Terroir — 茶畑の風景" ratio={1.778} />
        <div className="mx-auto -mt-16 max-w-2xl bg-background px-8 py-12 text-center md:-mt-24 md:px-16 md:py-16">
          <Overline>Our Approach</Overline>
          <h2 className="mt-4" style={{ fontWeight: 300 }}>
            ローカルでユニークな
            <br />
            ものづくりを支える
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            生産者と産地の情熱を、その魅力とともに伝える。
            持続可能なサプライチェーンによる、誠実なものづくり。
          </p>
          <Button variant="outline" className="mt-8">
            About elxea
          </Button>
        </div>
      </section>

      {/* 6. JOURNAL — editorial 7/5 lead + stacked (fractal rhythm) */}
      <section className="px-6 py-28 md:px-16">
        <div className="mb-14 flex items-end justify-between">
          <div>
            <Overline>Journal</Overline>
            <h2 className="mt-3" style={{ fontWeight: 300 }}>
              Stories of Tea &amp; Creativity
            </h2>
          </div>
          <Button variant="link" className="hidden text-muted-foreground md:inline-flex">
            All stories →
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          <article className="md:col-span-7">
            <Plate label="Lead Article" ratio={1.5} />
            <div className="mt-5">
              <Badge variant="secondary" className="text-[10px]">
                Culture
              </Badge>
              <h3 className="mt-3" style={{ fontWeight: 400 }}>
                喫茶去 — お茶を楽しむ人々のための、新時代の喫茶コミュニティ
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                食、音楽、農業。垣根を超えた出会いの場としての、お茶。
              </p>
            </div>
          </article>
          <div className="flex flex-col gap-10 md:col-span-5">
            {[
              { tag: "Origin", title: "宇治のテロワールを訪ねて" },
              { tag: "Ritual", title: "一杯を淹れるという所作について" },
            ].map((a) => (
              <article key={a.title} className="flex gap-5">
                <div className="w-36 shrink-0">
                  <Plate label="Article" ratio={1.333} />
                </div>
                <div>
                  <Badge variant="secondary" className="text-[10px]">
                    {a.tag}
                  </Badge>
                  <h4 className="mt-2 leading-snug" style={{ fontWeight: 500 }}>
                    {a.title}
                  </h4>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 7. NEWSLETTER / COMMUNITY — quiet invitation band */}
      <section className="bg-muted px-6 py-24 text-center md:px-16">
        <Overline>Join the circle</Overline>
        <h2 className="mx-auto mt-4 max-w-xl" style={{ fontWeight: 300 }}>
          きらめく一杯のお便りを、あなたにも。
        </h2>
        <div className="mx-auto mt-8 flex max-w-md gap-3">
          <div className="h-10 flex-1 rounded-md border border-border bg-background" />
          <Button>Subscribe</Button>
        </div>
      </section>

    </main>
  );
}
