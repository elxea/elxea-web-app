/**
 * eslint-plugin-elxea-tokens
 *
 * Local ESLint plugin that enforces design token usage.
 */
import noRawColors from "./no-raw-colors.mjs";
import noNewKarteFields from "./no-new-karte-fields.mjs";

const plugin = {
  meta: {
    name: "eslint-plugin-elxea-tokens",
    version: "1.1.0",
  },
  rules: {
    "no-raw-colors": noRawColors,
    // roji 判断2 の機械強制: 新しいカルテ項目を web-app 側に足させない（cx-agent の lineUsers へ）。
    "no-new-karte-fields": noNewKarteFields,
  },
};

export default plugin;
