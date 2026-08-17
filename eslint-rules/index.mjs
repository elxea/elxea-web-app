/**
 * eslint-plugin-elxea-tokens
 *
 * Local ESLint plugin that enforces design token usage.
 */
import noRawColors from "./no-raw-colors.mjs";
import noColorlessBorder from "./no-colorless-border.mjs";
import noNewKarteFields from "./no-new-karte-fields.mjs";
import sectionSpacingUtility from "./section-spacing-utility.mjs";

const plugin = {
  meta: {
    name: "eslint-plugin-elxea-tokens",
    version: "1.1.0",
  },
  rules: {
    "no-raw-colors": noRawColors,
    "no-colorless-border": noColorlessBorder,
    // roji 判断2 の機械強制: 新しいカルテ項目を web-app 側に足させない（cx-agent の lineUsers へ）。
    "no-new-karte-fields": noNewKarteFields,
    "section-spacing-utility": sectionSpacingUtility,
  },
};

export default plugin;
