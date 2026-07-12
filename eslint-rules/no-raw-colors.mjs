/**
 * ESLint rule: no-raw-colors
 *
 * Detects raw design values in JSX/TSX files and enforces the use of
 * design tokens (@theme / Tailwind token utilities) instead.
 *
 * Targets:
 * 1. Tailwind arbitrary color values in className strings:
 *    bg-[#xxx], text-[rgb(...)], border-[oklch(...)], etc.
 * 2. Raw color values in style props:
 *    style={{ color: "#fff" }}, style={{ backgroundColor: "rgb(...)" }}
 * 3. Tailwind arbitrary length values in className strings (px/rem/em):
 *    p-[16px], gap-[10px], text-[13px], -mt-[2px], w-[1.5rem], leading-[1.2em]
 *    These should use the spacing / sizing / typography token scale instead.
 *
 * The arbitrary-length check can be disabled via rule options:
 *    "elxea-tokens/no-raw-colors": ["error", { checkArbitraryValues: false }]
 */

// Regex for Tailwind arbitrary color values in className strings
// Matches patterns like: bg-[#fff], text-[rgb(0,0,0)], border-[oklch(...)], fill-[hsl(...)]
const TAILWIND_ARBITRARY_COLOR_RE =
  /(?:bg|text|border|outline|ring|shadow|fill|stroke|accent|caret|decoration|divide|from|via|to|placeholder)-\[(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\()/g;

// Regex for Tailwind arbitrary *length* values with an explicit unit (px/rem/em).
// Prefix-agnostic on purpose: any `-[<number><unit>]` is a raw value that should
// come from the token scale. Requires a numeric + unit so it does NOT match
// legitimate escape hatches like grid-cols-[1fr_2fr], w-[calc(...)], top-[var(--x)],
// arbitrary url() image values, or percentage/viewport values (w-[47%], h-[100vh]).
const TAILWIND_ARBITRARY_LENGTH_RE =
  /-\[-?(?:\d+|\d*\.\d+)(?:px|rem|em)\]/g;

// Regex for raw color values (standalone, for style props)
const RAW_COLOR_VALUE_RE =
  /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(.+\))$/;

// CSS properties that accept color values
const COLOR_PROPERTIES = new Set([
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "fill",
  "stroke",
  "caretColor",
  "accentColor",
  "columnRuleColor",
  "floodColor",
  "lightingColor",
  "stopColor",
  "background",
]);

const COLOR_MESSAGE =
  "Raw color value detected. Use a @theme design token instead (e.g., Tailwind utility class like `bg-primary` or CSS variable like `var(--color-primary)`).";

const LENGTH_MESSAGE =
  "Raw arbitrary length value detected (px/rem/em). Use a spacing/sizing/typography token from the scale instead (e.g., `p-4`, `gap-2`, `text-sm`) rather than an arbitrary `[..px]` value.";

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw color values (HEX, rgb, oklch, etc.) and arbitrary length values (px/rem/em) in favor of design tokens",
      recommended: true,
    },
    messages: {
      noRawColor: COLOR_MESSAGE,
      noArbitraryValue: LENGTH_MESSAGE,
    },
    schema: [
      {
        type: "object",
        properties: {
          checkArbitraryValues: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const checkArbitraryValues = options.checkArbitraryValues !== false;

    return {
      // Detect arbitrary color / length values in className string literals
      // Handles: className="bg-[#fff]", className={`bg-[#fff]`}
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!isInClassNameContext(node)) return;
        checkString(context, node, node.value, checkArbitraryValues);
      },

      // Detect in template literal expressions (className={`...`})
      TemplateLiteral(node) {
        if (!isInClassNameContext(node)) return;
        for (const quasi of node.quasis) {
          checkString(context, quasi, quasi.value.raw, checkArbitraryValues);
        }
      },

      // Detect raw color values in style={{ color: "#xxx" }}
      Property(node) {
        if (
          node.key &&
          (node.key.type === "Identifier" || node.key.type === "Literal")
        ) {
          const propName =
            node.key.type === "Identifier" ? node.key.name : node.key.value;

          if (!COLOR_PROPERTIES.has(propName)) return;
          if (!isInStyleProp(node)) return;

          if (
            node.value &&
            node.value.type === "Literal" &&
            typeof node.value.value === "string" &&
            RAW_COLOR_VALUE_RE.test(node.value.value)
          ) {
            context.report({
              node: node.value,
              messageId: "noRawColor",
            });
          }
        }
      },
    };
  },
};

/**
 * Check if a node is within a className attribute context.
 * Covers: className="...", className={...}, className={cn(...)}, clsx(...), cva(...)
 */
function isInClassNameContext(node) {
  let current = node.parent;
  while (current) {
    // Direct className attribute: className="..."
    if (
      current.type === "JSXAttribute" &&
      current.name &&
      current.name.name === "className"
    ) {
      return true;
    }
    // className={expression} — check JSXExpressionContainer parent
    if (current.type === "JSXExpressionContainer") {
      if (
        current.parent &&
        current.parent.type === "JSXAttribute" &&
        current.parent.name &&
        current.parent.name.name === "className"
      ) {
        return true;
      }
    }
    // Inside cn(), clsx(), cva(), twMerge() calls
    if (
      current.type === "CallExpression" &&
      current.callee &&
      current.callee.type === "Identifier" &&
      ["cn", "clsx", "cva", "twMerge", "twJoin"].includes(current.callee.name)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check if a Property node is inside a style JSX attribute.
 */
function isInStyleProp(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === "JSXAttribute" &&
      current.name &&
      current.name.name === "style"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check a string value for Tailwind arbitrary color / length patterns and report.
 */
function checkString(context, node, value, checkArbitraryValues) {
  TAILWIND_ARBITRARY_COLOR_RE.lastIndex = 0;
  if (TAILWIND_ARBITRARY_COLOR_RE.test(value)) {
    context.report({
      node,
      messageId: "noRawColor",
    });
  }

  if (checkArbitraryValues) {
    TAILWIND_ARBITRARY_LENGTH_RE.lastIndex = 0;
    if (TAILWIND_ARBITRARY_LENGTH_RE.test(value)) {
      context.report({
        node,
        messageId: "noArbitraryValue",
      });
    }
  }
}

export default rule;
