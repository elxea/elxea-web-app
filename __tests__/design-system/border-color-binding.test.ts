import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { toggleVariants } from "@/components/ui/toggle";

import { findColorless, classify, splitVariants } from "@/eslint-rules/no-colorless-border.mjs";

/**
 * Machine guard for the 罫線色 contract.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * In Tailwind v4 `border` sets `border-width` and nothing else. CSS resolves an
 * unset `border-color` to `currentColor`, so a border with no color class is
 * painted in the element's *text* color. On this site that is
 * `--color-foreground` (graphite #464748) rather than `--color-border`
 * (#888675). Measured on /ja/cart with canvas getImageData: the outline Button
 * drew #464748 on all four edges before this task.
 *
 * The same defect was found and patched three times in a row on individual
 * screens, so the guard is on the *class of bug*:
 *   1. `elxea-tokens/no-colorless-border` fails `pnpm lint` (pre-push) for any
 *      new colorless border anywhere in app/**, components/** or stories/**.
 *   2. This test pins the pieces ESLint cannot see: that the rule stays wired
 *      at error level, that the DS variant space is clean when evaluated as
 *      real runtime strings, and that the implicit shadcn escape hatch stays
 *      out of globals.css.
 *
 * Keep 1 and 2 together. Deleting either one lets the defect back in silently.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/** Enumerate every variant/size combination a cva function can produce. */
const variantMatrix = (
  fn: (args: Record<string, string>) => string,
  variants: string[],
  sizes: string[]
) => {
  const out: { label: string; classes: string }[] = [];
  for (const variant of variants) {
    for (const size of sizes) {
      out.push({ label: `${variant}/${size}`, classes: fn({ variant, size }) });
    }
  }
  return out;
};

describe("no-colorless-border: the checker itself", () => {
  // If the analyzer is wrong, every other assertion below is worthless, so its
  // truth table is pinned first.
  const cases: [string, number][] = [
    // colorless width -> reported
    ["border rounded-lg", 1],
    ["border-b", 1],
    ["divide-y", 1],
    ["border-solid border-2", 1],
    ["border-b-[0.5px]", 1],
    // width + color in the same state -> clean
    ["border border-border", 0],
    ["border-t border-border", 0],
    ["border-2 border-brand-gold", 0],
    ["divide-y divide-border", 0],
    ["border border-white/40", 0],
    ["border-[#fff]", 0],
    // zero width / no border -> nothing to color
    ["border-0", 0],
    ["border-none", 0],
    ["border-collapse", 0],
    ["border-spacing-2", 0],
    // explicit opt-in to the text color -> allowed, and self-documenting
    ["border border-current", 0],
    // variant prefixes must line up: a dark-only color does not paint the
    // light-mode border. This exact shape was the DS Button bug.
    ["border dark:border-input", 1],
    ["dark:border dark:border-input", 0],
    ["focus-visible:border-ring border", 1],
    ["hover:border-b hover:border-border", 0],
    // an unprefixed color covers every state
    ["hover:border-b border-border", 0],
    // arbitrary variants with inner colons must not break tokenizing
    ["[&_svg:not([class*='size-'])]:size-4 border", 1],
  ];

  for (const [classes, expected] of cases) {
    it(`reports ${expected} for "${classes}"`, () => {
      expect(findColorless(classes.split(/\s+/))).toHaveLength(expected);
    });
  }

  it("classifies width, color and style suffixes apart", () => {
    expect(classify("border")).toMatchObject({ role: "width", visible: true });
    expect(classify("border-2")).toMatchObject({ role: "width", visible: true });
    expect(classify("border-0")).toMatchObject({ role: "width", visible: false });
    expect(classify("border-t")).toMatchObject({ role: "width", visible: true });
    expect(classify("border-border")).toMatchObject({ role: "color" });
    expect(classify("border-t-border")).toMatchObject({ role: "color" });
    expect(classify("divide-border")).toMatchObject({ role: "color" });
    expect(classify("border-dashed")).toBeNull();
    expect(classify("rounded-lg")).toBeNull();
  });

  it("splits variant prefixes without cutting inside brackets", () => {
    expect(splitVariants("dark:hover:border")).toEqual([["dark", "hover"], "border"]);
    expect(splitVariants("[&_svg:not([class*='size-'])]:size-4")).toEqual([
      ["[&_svg:not([class*='size-'])]"],
      "size-4",
    ]);
  });
});

describe("DS variant space paints no border in the body text color", () => {
  // Evaluated as the real runtime strings, so this covers what a static file
  // scan cannot: the base string and one variant string concatenated.
  const suites = [
    {
      name: "buttonVariants",
      rows: variantMatrix(
        buttonVariants as (a: Record<string, string>) => string,
        ["default", "destructive", "outline", "secondary", "ghost", "link", "service"],
        ["default", "service", "cta", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"]
      ),
    },
    {
      name: "toggleVariants",
      rows: variantMatrix(
        toggleVariants as (a: Record<string, string>) => string,
        ["default", "outline"],
        ["default", "sm", "lg"]
      ),
    },
    {
      name: "badgeVariants",
      rows: ["default", "secondary", "destructive", "outline"].map((variant) => ({
        label: variant,
        classes: (badgeVariants as (a: Record<string, string>) => string)({ variant }),
      })),
    },
  ];

  for (const suite of suites) {
    it(`${suite.name}: every combination binds its border color`, () => {
      const bad = suite.rows
        .filter((row) => findColorless(row.classes.split(/\s+/)).length > 0)
        .map((row) => `${suite.name}(${row.label})`);
      expect(bad).toEqual([]);
    });
  }

  it("Button outline keeps an explicit light-mode border color", () => {
    // Regression pin: it used to carry only `dark:border-input`, so the light
    // theme fell through to currentColor and drew a graphite outline.
    const outline = (buttonVariants as (a: Record<string, string>) => string)({
      variant: "outline",
    });
    expect(outline).toContain("border-input");
    expect(findColorless(outline.split(/\s+/))).toEqual([]);
  });
});

describe("the implicit escape hatch stays closed", () => {
  it("globals.css does not reintroduce the shadcn `* { border-color }` reset", () => {
    const css = fs.readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
    // Strip comments first: the file documents on purpose why the rule is
    // absent, and that prose must not trip the check.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const resetLike =
      /\*\s*(,[^{]*)?\{[^}]*(@apply[^;}]*border-border|border-color\s*:)/;
    expect(resetLike.test(code)).toBe(false);
  });

  it("eslint.config.mjs keeps no-colorless-border at error level for the UI tree", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/"elxea-tokens\/no-colorless-border":\s*"error"/);
    const block = cfg.slice(cfg.indexOf("no-colorless-border") - 1200);
    for (const glob of ["app/**/*.tsx", "components/**/*.tsx", "stories/**/*.tsx"]) {
      expect(block).toContain(glob);
    }
  });

  it("the plugin still exports the rule", async () => {
    const plugin = await import("@/eslint-rules/index.mjs");
    expect(plugin.default.rules["no-colorless-border"]).toBeTruthy();
  });
});
