/**
 * ESLint rule: no-raw-colors
 *
 * Detects raw color values in JSX/TSX files and enforces the use of
 * design tokens (@theme) instead.
 *
 * Targets:
 * 1. Tailwind arbitrary color values in className strings:
 *    bg-[#xxx], text-[rgb(...)], border-[oklch(...)], etc.
 * 2. Raw color values in style props:
 *    style={{ color: "#fff" }}, style={{ backgroundColor: "rgb(...)" }}
 */

// Regex for Tailwind arbitrary color values in className strings
// Matches patterns like: bg-[#fff], text-[rgb(0,0,0)], border-[oklch(...)], fill-[hsl(...)]
const TAILWIND_ARBITRARY_COLOR_RE =
  /(?:bg|text|border|outline|ring|shadow|fill|stroke|accent|caret|decoration|divide|from|via|to|placeholder)-\[(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\()/g;

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

const MESSAGE =
  "Raw color value detected. Use a @theme design token instead (e.g., Tailwind utility class like `bg-primary` or CSS variable like `var(--color-primary)`).";

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw color values (HEX, rgb, oklch, etc.) in favor of design tokens",
      recommended: true,
    },
    messages: {
      noRawColor: MESSAGE,
    },
    schema: [],
  },
  create(context) {
    return {
      // Detect arbitrary color values in className string literals
      // Handles: className="bg-[#fff]", className={`bg-[#fff]`}
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!isInClassNameContext(node)) return;
        checkStringForArbitraryColors(context, node, node.value);
      },

      // Detect in template literal expressions (className={`...`})
      TemplateLiteral(node) {
        if (!isInClassNameContext(node)) return;
        for (const quasi of node.quasis) {
          checkStringForArbitraryColors(
            context,
            quasi,
            quasi.value.raw,
          );
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
 * Check a string value for Tailwind arbitrary color patterns and report.
 */
function checkStringForArbitraryColors(context, node, value) {
  TAILWIND_ARBITRARY_COLOR_RE.lastIndex = 0;
  if (TAILWIND_ARBITRARY_COLOR_RE.test(value)) {
    context.report({
      node,
      messageId: "noRawColor",
    });
  }
}

export default rule;
