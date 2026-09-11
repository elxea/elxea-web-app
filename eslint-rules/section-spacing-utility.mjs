/**
 * ESLint rule: section-spacing-utility
 *
 * Machine-enforces design-system-audit category **C3** (severity CRITICAL):
 * "セクション余白・最大幅は共通ユーティリティ" — a section's vertical rhythm and
 * max-width must come from the shared utility, and the spacing between stacked
 * blocks must be owned by the container that arranges them.
 *
 * Until now C3 existed only as prose in the `design-system-audit` skill, and
 * qa-pipeline ran that skill as a **SOFT** gate (Gate 3): a violation was
 * recorded as a warning and the pipeline continued, so nothing stopped. Two
 * defects reached production through that gap. The CRITICAL half of C3 is
 * therefore enforced here in code: the rule is wired at `error` level and
 * `pnpm lint` runs with `--max-warnings 0` in the CI `static-checks` job, which
 * every PR must pass.
 *
 * ## D1 `handRolledSectionContainer`
 *
 * `mx-auto` + `max-w-*` + vertical padding re-implements `.section-narrow` /
 * `.section-wide` / `.section-full` (app/globals.css). Hand-rolled copies drift
 * from the utility, which is how "max-width and section padding are shared"
 * silently stops being true. In main, `app/[locale]/page.tsx:316` had
 * `max-w-7xl mx-auto px-6 py-24` while `.section-wide` is
 * `max-w-7xl mx-auto px-6 py-16`, and the identical hand-rolled container
 * `mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40` was copied
 * across eight legal/contact/faq pages.
 *
 * Vertical padding is required for a match on purpose: it is what distinguishes
 * a *section* from a merely centered element. `<p className="max-w-2xl mx-auto">`
 * centering a lead paragraph is not a section and is not reported.
 *
 * ## D2 `missingRowGap`
 *
 * A container that stacks children vertically (`flex-col`, or `grid` with rows)
 * and declares a **horizontal** gap but no row gap. The author was thinking
 * about gaps and set only the x axis, so vertical spacing silently falls to
 * whatever each child brings — and any child that brings none sits flush at
 * 0px. Nothing in types, unit tests, or Storybook catches it, because each part
 * is individually correct.
 *
 * This is the exact 2026-08-17 /ja/playlists defect. `JournalLayout` was
 * `flex flex-col` + `lg:grid lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:gap-x-8`
 * with no row gap; spacing was delegated to each child writing
 * `mt-8 lg:mt-12`; `ArticleRail` did not, so on SP the sidebar sat against the
 * article grid at a measured marginTop of 0px. It only showed on pages with few
 * items, because elsewhere the "more" row's own margin happened to fill the
 * hole. The fix — giving the layout `gap-y-8 lg:gap-y-12` — is exactly what
 * makes this rule stop firing, so the suppression clears when the debt is
 * actually paid rather than becoming permanent noise.
 *
 * `gap-y-*` / `gap-*` / `space-y-*` are the correct container-owns-spacing
 * patterns and are never reported.
 *
 * ## Escape hatch and kill switch
 *
 * A `DS-exception: <reason>` comment on or immediately above the element skips
 * it — the same convention the design-system-audit skill already documents, so
 * one annotation satisfies both the lint and the audit.
 *
 * Kill switch: set `"elxea-tokens/section-spacing-utility": "off"` in
 * eslint.config.mjs. Pre-existing violations are grandfathered in
 * eslint-suppressions.json, so only new code fails.
 */

// Optional Tailwind variant prefixes (sm:, lg:, hover:, max-md:, dark:, ...).
const V = "(?:[\\w[\\]().<>=-]+:)*";

// max-w-<token>, excluding none/full which establish no measured content width.
const MAX_WIDTH_RE = new RegExp(`\\s${V}max-w-(?!none\\s|full\\s)[\\w[\\]().%,-]+\\s`);
const MX_AUTO_RE = new RegExp(`\\s${V}mx-auto\\s`);

// Vertical padding: py-/pt-/pb-. This is a section's rhythm.
const VERTICAL_PADDING_RE = new RegExp(`\\s${V}p[ytb]-[\\w[\\]().%,-]+\\s`);

// Shared section utilities defined in app/globals.css.
const SHARED_SECTION_RE = /\ssection-(?:narrow|wide|full)\s/;

// Vertical stacking: flex-col, or any grid (grid rows stack by default).
const VERTICAL_STACK_RE = new RegExp(`\\s${V}(?:flex-col|grid|grid-cols-[\\w[\\]().,_-]+)\\s`);

// Horizontal-only gap declared...
const GAP_X_RE = new RegExp(`\\s${V}gap-x-[\\w[\\]().%,-]+\\s`);
// ...while none of these provide vertical spacing between rows.
const ROW_SPACING_RE = new RegExp(
  `\\s${V}(?:gap-y-[\\w[\\]().%,-]+|gap-[\\w[\\]().%,-]+|space-y-[\\w[\\]().%,-]+|divide-y[\\w-]*)\\s`,
);

const DS_EXCEPTION_RE = /DS-exception\s*:/;

/** `gap-x-8` must not satisfy the bare-`gap-` branch of ROW_SPACING_RE. */
function hasRowSpacing(classes) {
  const stripped = classes.replace(new RegExp(`\\s${V}gap-x-[\\w[\\]().%,-]+(?=\\s)`, "g"), " ");
  return ROW_SPACING_RE.test(stripped);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce design-system-audit C3: section max-width/padding must come from the shared section utility, and vertical spacing between stacked blocks must be owned by the arranging container",
      recommended: true,
    },
    messages: {
      handRolledSectionContainer:
        "Hand-rolled section container (`mx-auto` + `max-w-*` + vertical padding) duplicates the shared utility and will drift from it. Use `section-narrow` / `section-wide` / `section-full` from app/globals.css, or annotate with `DS-exception: <reason>`. (design-system-audit C3, CRITICAL)",
      missingRowGap:
        "This container stacks children vertically and declares a horizontal gap (`gap-x-*`) but no row gap. Vertical spacing then depends on each child supplying its own margin, and any child that omits it collapses to 0px silently. Add `gap-y-*` (or `gap-*` / `space-y-*`) here instead of delegating spacing to the children. (design-system-audit C3, CRITICAL)",
    },
    schema: [
      {
        type: "object",
        properties: {
          checkHandRolledContainer: { type: "boolean" },
          checkMissingRowGap: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const checkContainer = options.checkHandRolledContainer !== false;
    const checkRowGap = options.checkMissingRowGap !== false;
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * All className fragments belonging to one element are merged before being
     * tested, so `cn("max-w-3xl", "mx-auto", "py-20")` is judged as a single
     * class list rather than as unrelated pieces.
     * @type {Map<object, string[]>}
     */
    const classLists = new Map();

    function record(attr, value) {
      const parts = classLists.get(attr);
      if (parts) parts.push(value);
      else classLists.set(attr, [value]);
    }

    // Lines carrying a `DS-exception:` comment. A JSX `{/* ... */}` comment is a
    // sibling JSXExpressionContainer rather than a comment attached to the
    // element, so token-based lookup (getCommentsBefore) does not find it.
    // Matching on line position instead covers JSX comments, `//` line comments
    // and trailing comments uniformly.
    let exceptionLines = null;
    function getExceptionLines() {
      if (exceptionLines) return exceptionLines;
      exceptionLines = new Set();
      for (const comment of sourceCode.getAllComments()) {
        if (!DS_EXCEPTION_RE.test(comment.value)) continue;
        for (let l = comment.loc.start.line; l <= comment.loc.end.line; l++) {
          exceptionLines.add(l);
        }
      }
      return exceptionLines;
    }

    /**
     * Honoured when the annotation sits on the element's own line, or on either
     * of the two lines immediately above it (enough room for a JSX comment plus
     * the opening tag).
     */
    function hasDsException(attr) {
      const lines = getExceptionLines();
      if (lines.size === 0) return false;
      let element = attr.parent;
      while (element && element.type !== "JSXOpeningElement") element = element.parent;
      const start = (element ?? attr).loc.start.line;
      return lines.has(start) || lines.has(start - 1) || lines.has(start - 2);
    }

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const attr = findClassNameAttribute(node);
        if (attr) record(attr, node.value);
      },

      TemplateLiteral(node) {
        const attr = findClassNameAttribute(node);
        if (!attr) return;
        for (const quasi of node.quasis) record(attr, quasi.value.raw);
      },

      "Program:exit"() {
        for (const [attr, parts] of classLists) {
          // Pad with spaces so every pattern can anchor on whitespace.
          const classes = ` ${parts.join(" ").replace(/\s+/g, " ").trim()} `;
          if (SHARED_SECTION_RE.test(classes)) continue;

          if (
            checkContainer &&
            MX_AUTO_RE.test(classes) &&
            MAX_WIDTH_RE.test(classes) &&
            VERTICAL_PADDING_RE.test(classes) &&
            !hasDsException(attr)
          ) {
            context.report({ node: attr, messageId: "handRolledSectionContainer" });
          }

          if (
            checkRowGap &&
            VERTICAL_STACK_RE.test(classes) &&
            GAP_X_RE.test(classes) &&
            !hasRowSpacing(classes) &&
            !hasDsException(attr)
          ) {
            context.report({ node: attr, messageId: "missingRowGap" });
          }
        }
      },
    };
  },
};

/**
 * Resolve the `className` JSX attribute that a string node contributes to, so
 * all fragments of one element are grouped. Returns null when the node is not
 * part of a className (e.g. a CVA variant map defined outside JSX, which is the
 * shared definition and correctly out of scope).
 */
function findClassNameAttribute(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === "JSXAttribute" &&
      current.name &&
      current.name.name === "className"
    ) {
      return current;
    }
    // Reached an element boundary without finding className.
    if (current.type === "JSXOpeningElement") return null;
    current = current.parent;
  }
  return null;
}

export default rule;
