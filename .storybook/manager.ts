import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

/**
 * elxea Design System カタログ — 対外名称の一元定義。
 *
 * Naming: 対外名称は「elxea Design System カタログ」、内部名 (script / path / CI job) は
 * design-catalog。roji 固有名は使わない — このカタログは roji だけのものではなく
 * elxea 全体の共通基盤だから。ツール実体は Storybook のままで、載せ替えはしない。
 */
addons.setConfig({
  theme: create({
    base: "light",
    brandTitle: "elxea Design System カタログ",
    brandTarget: "_self",
  }),
});
