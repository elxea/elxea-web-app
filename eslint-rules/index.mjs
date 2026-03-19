/**
 * eslint-plugin-elxea-tokens
 *
 * Local ESLint plugin that enforces design token usage.
 */
import noRawColors from "./no-raw-colors.mjs";

const plugin = {
  meta: {
    name: "eslint-plugin-elxea-tokens",
    version: "1.0.0",
  },
  rules: {
    "no-raw-colors": noRawColors,
  },
};

export default plugin;
