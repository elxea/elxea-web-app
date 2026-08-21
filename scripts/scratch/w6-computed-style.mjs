// Wave 6 runtime verification: resolve design tokens + real element backgrounds
// via getComputedStyle in a real browser. Throwaway (scripts/scratch is gitignored).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const PATHS = (process.env.PATHS ?? "/password").split(",");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const out = {};

for (const p of PATHS) {
  const url = BASE + p;
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    status = res?.status() ?? null;
  } catch (e) {
    out[p] = { error: String(e).split("\n")[0] };
    continue;
  }

  const data = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of [
      "--color-card",
      "--color-card-foreground",
      "--color-secondary",
      "--color-popover",
      "--color-muted",
      "--color-background",
      "--color-border",
      "--color-input",
      "--color-foreground",
    ]) {
      vars[name] = root.getPropertyValue(name).trim();
    }

    // Probe: create off-DOM-flow elements that use the same utilities the
    // components use, so the browser resolves them the same way.
    const probe = (cls) => {
      const el = document.createElement("div");
      el.className = cls;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.width = "10px";
      el.style.height = "10px";
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const v = { backgroundColor: cs.backgroundColor, color: cs.color, borderColor: cs.borderTopColor };
      el.remove();
      return v;
    };

    const probes = {
      "bg-card": probe("bg-card text-card-foreground border border-border"),
      "bg-secondary": probe("bg-secondary text-secondary-foreground border border-foreground"),
      "bg-muted": probe("bg-muted"),
      "bg-popover": probe("bg-popover"),
      "bg-background": probe("bg-background"),
      "border-input on card": probe("bg-card border border-input text-muted-foreground"),
      "destructive on card": probe("bg-card border border-destructive text-destructive"),
    };

    // Real elements already on the page that use bg-card.
    const real = [...document.querySelectorAll("*")]
      .filter((el) => el.classList && el.classList.contains("bg-card"))
      .slice(0, 5)
      .map((el) => {
        const cs = getComputedStyle(el);
        const parentCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
        return {
          tag: el.tagName.toLowerCase(),
          cls: el.className.toString().slice(0, 120),
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderTopColor,
          parentBackgroundColor: parentCs?.backgroundColor ?? null,
        };
      });

    return { vars, probes, real, bodyBg: getComputedStyle(document.body).backgroundColor };
  });

  out[p] = { status, ...data };
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
