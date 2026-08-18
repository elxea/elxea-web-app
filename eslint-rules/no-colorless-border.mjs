/**
 * ESLint rule: no-colorless-border
 *
 * Detects Tailwind border-*width* / divide-*width* utilities that are not
 * accompanied by a border-color / divide-color utility.
 *
 * WHY THIS IS A BUG (not a style nit)
 * ----------------------------------
 * In Tailwind v4 `border` only sets `border-width: 1px`; `border-t` only sets
 * `border-top-width: 1px`. Neither sets a color. CSS `border-color` initial
 * value is `currentColor`, so a colorless border inherits the *text* color of
 * the element. On this site the body text color is `--color-foreground`
 * (graphite #464748), so every colorless `border` draws a graphite hairline
 * where the design calls for the `border` token (#8b8a7f-ish warm grey).
 * The visual delta is large (roughly 3.5:1 contrast difference) and it is
 * invisible in code review because `border` *looks* complete.
 *
 * Found in production code by canvas pixel measurement in the C6-3R lane
 * (定期便管理のカード / パネル / 空カード) and again in the DS `Button`
 * `outline` variant. This rule stops the class of bug, not the instances.
 *
 * HOW IT DECIDES
 * --------------
 * 1. Class strings are grouped the way the browser sees them:
 *    - all strings inside one `className={...}` attribute form one group
 *      (they are concatenated at runtime),
 *    - `cva(base, config)` forms one group per variant string, each merged
 *      with the base string (base always applies, one variant at a time),
 *    - `cn()/clsx()/twMerge()/twJoin()` calls form one group,
 *    - any other string literal that contains a border utility is its own
 *      group (class maps, `const cls = "..."`, etc.).
 * 2. Variant prefixes are respected. `dark:border-input` does NOT satisfy a
 *    bare `border`, and `focus-visible:border-ring` does not either — those
 *    colors only apply in their own state. A width with prefix set P is
 *    satisfied only by a color whose prefix set is P or empty.
 *
 * HOW TO FIX
 * ----------
 * - Wanted a token line: add `border-border` (or `divide-border`).
 * - Genuinely wanted the text color: write `border-current` explicitly. The
 *   rule accepts it, and the intent becomes reviewable.
 * - Only setting width to zero: `border-0` / `border-none` are not reported.
 */

const SIDES = new Set(["t", "r", "b", "l", "s", "e", "x", "y"]);

const BORDER_STYLES = new Set([
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "none",
]);

// `border-collapse` / `border-separate` / `border-spacing-*` are table
// utilities, not border-width or border-color.
const TABLE_UTILS = new Set(["collapse", "separate"]);

const LENGTH_RE = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/;

const MESSAGE =
  "Colorless border utility `{{cls}}`: Tailwind sets only the width, so the " +
  "border falls back to `currentColor` (the text color) instead of the " +
  "`border` token. Add a border-color utility (e.g. `border-border`), or " +
  "write `border-current` if the text color is genuinely intended.";

const DIVIDE_MESSAGE =
  "Colorless divide utility `{{cls}}`: Tailwind sets only the width, so the " +
  "rule falls back to `currentColor` (the text color) instead of the " +
  "`border` token. Add `divide-border` (or `divide-current` if intended).";

/**
 * Split a Tailwind class into [variantPrefixes, base], bracket-aware so that
 * arbitrary variants such as `[&_svg:not([class*='size-'])]:size-4` and
 * arbitrary values such as `border-[url(a:b)]` are not split on their inner
 * colons.
 */
function splitVariants(cls) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const ch = cls[i];
    if (ch === "[" || ch === "(") depth += 1;
    else if (ch === "]" || ch === ")") depth -= 1;
    else if (ch === ":" && depth === 0) {
      parts.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(cls.slice(start));
  const base = parts.pop();
  return [parts, base];
}

/** Normalise a prefix list into a comparable key. */
function prefixKey(prefixes) {
  return prefixes.join(":");
}

/**
 * Classify one bare (variant-stripped) class.
 * Returns null when the class is irrelevant to border/divide coloring.
 */
function classify(bare) {
  let cls = bare;
  // Important markers: `!border` (v4) and `border!` (v3 style).
  if (cls.startsWith("!")) cls = cls.slice(1);
  if (cls.endsWith("!")) cls = cls.slice(0, -1);

  const isBorder = cls === "border" || cls.startsWith("border-");
  const isDivide = cls === "divide" || cls.startsWith("divide-");
  if (!isBorder && !isDivide) return null;

  const kind = isBorder ? "border" : "divide";
  const segments = cls.split("-");
  segments.shift(); // drop "border" / "divide"

  if (segments.length && SIDES.has(segments[0])) segments.shift();

  const rest = segments.join("-");

  // `border` / `border-t` / `divide-y`: width only, visible.
  if (rest === "") return { kind, role: "width", visible: true };

  if (kind === "divide" && rest === "reverse") return null;
  if (kind === "border" && TABLE_UTILS.has(rest)) return null;
  if (kind === "border" && rest.startsWith("spacing")) return null;

  if (/^\d+$/.test(rest)) {
    return { kind, role: "width", visible: rest !== "0" };
  }

  if (kind === "border" && BORDER_STYLES.has(rest)) {
    // `border-none` / `border-hidden` do not paint. Other style keywords do
    // not set a width on their own, so they are neither width nor color.
    return null;
  }

  // Arbitrary value: `border-[1px]` is a width, `border-[#fff]` is a color.
  if (rest.startsWith("[") || rest.startsWith("(")) {
    const inner = rest.slice(1, -1).trim();
    if (inner.startsWith("length:")) {
      return { kind, role: "width", visible: true };
    }
    if (LENGTH_RE.test(inner)) {
      return { kind, role: "width", visible: inner !== "0" };
    }
    return { kind, role: "color" };
  }

  // Anything else after the (optional) side is a color: `border-border`,
  // `border-brand-gold`, `border-neutral-200`, `border-white/40`,
  // `border-current`, `border-transparent`, `divide-border`.
  return { kind, role: "color" };
}

/**
 * Decide which colorless border/divide widths a group of classes contains.
 * @param {string[]} classes
 * @returns {{cls: string, kind: string}[]} offending classes
 */
function findColorless(classes) {
  /** @type {{border: Set<string>, divide: Set<string>}} */
  const colorPrefixes = { border: new Set(), divide: new Set() };
  /** @type {{cls: string, kind: string, prefixes: string[]}[]} */
  const widths = [];

  for (const raw of classes) {
    const [prefixes, bare] = splitVariants(raw);
    const info = classify(bare);
    if (!info) continue;
    if (info.role === "color") {
      colorPrefixes[info.kind].add(prefixKey(prefixes));
    } else if (info.role === "width" && info.visible) {
      widths.push({ cls: raw, kind: info.kind, prefixes });
    }
  }

  const offenders = [];
  for (const w of widths) {
    const available = colorPrefixes[w.kind];
    // An unprefixed color applies in every state, so it always satisfies.
    if (available.has("")) continue;
    // Otherwise the color must be declared under exactly the same state.
    if (available.has(prefixKey(w.prefixes))) continue;
    offenders.push({ cls: w.cls, kind: w.kind });
  }
  return offenders;
}

const CLASS_HELPERS = new Set(["cn", "clsx", "twMerge", "twJoin", "classNames"]);
const BORDER_HINT_RE = /(?:^|\s)!?(?:[\w[\]&*='":.,()#/-]*:)?!?(?:border|divide)\b/;

function calleeName(node) {
  if (!node.callee) return null;
  if (node.callee.type === "Identifier") return node.callee.name;
  if (
    node.callee.type === "MemberExpression" &&
    node.callee.property &&
    node.callee.property.type === "Identifier"
  ) {
    return node.callee.property.name;
  }
  return null;
}

/** Collect every static string in a subtree, with the node it came from. */
function collectStrings(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return;
  }
  if (typeof node.type !== "string") return;

  if (node.type === "Literal" && typeof node.value === "string") {
    out.push({ node, value: node.value });
    return;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) {
      out.push({ node: quasi, value: quasi.value.raw });
    }
    // fall through so expressions inside the template are also scanned
  }
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    collectStrings(node[key], out);
  }
}

function tokenize(value) {
  return value.split(/\s+/).filter(Boolean);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Tailwind border/divide width utilities without a matching border-color utility (they silently fall back to currentColor)",
      recommended: true,
    },
    messages: {
      colorlessBorder: MESSAGE,
      colorlessDivide: DIVIDE_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const reported = new Set();

    function report(node, cls, kind) {
      const key = `${node.range[0]}:${node.range[1]}:${cls}`;
      if (reported.has(key)) return;
      reported.add(key);
      context.report({
        node,
        messageId: kind === "divide" ? "colorlessDivide" : "colorlessBorder",
        data: { cls },
      });
    }

    /**
     * Analyse one group. `strings` is a list of {node, value}. Offenders are
     * reported on the string node that actually holds the class.
     */
    function analyseGroup(strings, extraContextClasses = []) {
      const all = [...extraContextClasses];
      for (const s of strings) all.push(...tokenize(s.value));
      const offenders = findColorless(all);
      if (offenders.length === 0) return;

      for (const off of offenders) {
        // Attribute the report to the string that contains the class.
        const owner =
          strings.find((s) => tokenize(s.value).includes(off.cls)) ??
          strings[0];
        if (!owner) continue;
        report(owner.node, off.cls, off.kind);
      }
    }

    function handleCva(node) {
      const [baseArg, configArg] = node.arguments;
      const baseStrings = [];
      collectStrings(baseArg, baseStrings);
      const baseClasses = baseStrings.flatMap((s) => tokenize(s.value));

      // The base string is always applied, so check it on its own too.
      analyseGroup(baseStrings);

      if (!configArg) return;
      const variantStrings = [];
      collectStrings(configArg, variantStrings);
      for (const s of variantStrings) {
        if (!BORDER_HINT_RE.test(` ${s.value}`)) continue;
        analyseGroup([s], baseClasses);
      }
    }

    /**
     * Manual top-down walk so that grouping is decided by the outermost
     * construct (className attribute / cva / cn) rather than by visitor order.
     */
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (typeof node.type !== "string") return;

      if (
        node.type === "JSXAttribute" &&
        node.name &&
        node.name.name === "className"
      ) {
        const strings = [];
        collectStrings(node.value, strings);
        analyseGroup(strings);
        return;
      }

      if (node.type === "CallExpression") {
        const name = calleeName(node);
        if (name === "cva") {
          handleCva(node);
          return;
        }
        if (name && CLASS_HELPERS.has(name)) {
          const strings = [];
          collectStrings(node, strings);
          analyseGroup(strings);
          return;
        }
      }

      if (node.type === "Literal" && typeof node.value === "string") {
        if (BORDER_HINT_RE.test(` ${node.value}`)) {
          analyseGroup([{ node, value: node.value }]);
        }
        return;
      }

      if (node.type === "TemplateLiteral") {
        const strings = [];
        for (const quasi of node.quasis) {
          strings.push({ node: quasi, value: quasi.value.raw });
        }
        if (strings.some((s) => BORDER_HINT_RE.test(` ${s.value}`))) {
          analyseGroup(strings);
        }
        for (const expr of node.expressions) walk(expr);
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === "parent" || key === "loc" || key === "range") continue;
        walk(node[key]);
      }
    }

    return {
      "Program:exit"() {
        walk(sourceCode.ast);
      },
    };
  },
};

export default rule;
export { classify, findColorless, splitVariants };
