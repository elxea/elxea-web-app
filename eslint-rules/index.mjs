/**
 * eslint-plugin-elxea-tokens
 *
 * Local ESLint plugin that enforces design token usage.
 */
import noRawColors from "./no-raw-colors.mjs";
import noColorlessBorder from "./no-colorless-border.mjs";
import noNewKarteFields from "./no-new-karte-fields.mjs";
import sectionSpacingUtility from "./section-spacing-utility.mjs";
import mutationThroughSharedPrimitive from "./mutation-through-shared-primitive.mjs";
import noSilentCatchAtBoundary from "./no-silent-catch-at-boundary.mjs";
import cookieNameThroughRegistry from "./cookie-name-through-registry.mjs";

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
    // 「押した瞬間に効く」を機構側で保証する: 画面からの書き込みは
    // lib/interaction の共通 hook を通す (迂回はビルドで落ちる)。
    "mutation-through-shared-primitive": mutationThroughSharedPrimitive,
    // 憲章 R1 の全域展開: 外部境界の catch は投げ直すか調査できる形に残す
    // (console だけで済ませると誰にも届かない)。
    "no-silent-catch-at-boundary": noSilentCatchAtBoundary,
    // 憲章 R5/R8: cookie の名前は lib/auth/cookie-names.ts の 1 表から引く
    // (生文字列で書くと「発行はするが消えない」cookie が生える)。
    "cookie-name-through-registry": cookieNameThroughRegistry,
  },
};

export default plugin;
