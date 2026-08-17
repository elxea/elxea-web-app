import { RuleTester } from "eslint";

import rule from "../../eslint-rules/section-spacing-utility.mjs";

/**
 * Machine assertion for design-system-audit C3 (CRITICAL) enforcement.
 *
 * C3 used to be prose only: qa-pipeline ran `design-system-audit` as Gate 3, a
 * SOFT gate that recorded a warning and continued, so a C3 CRITICAL finding
 * never blocked anything. The /ja/playlists 0px-gap defect shipped through that
 * gap on 2026-08-17 even though C3 describes it exactly.
 *
 * These cases pin the two behaviours that make the promotion real:
 *  1. the rule fires on the ACTUAL pre-fix defect markup, and
 *  2. it stops firing on the ACTUAL post-fix markup — so paying the debt clears
 *     the finding, instead of leaving a permanent suppression that everyone
 *     learns to ignore.
 *
 * RuleTester generates its own describe/it blocks, so these calls must stay at
 * the top level of the module.
 */

// The exact JournalLayout class list before and after the 2026-08-17 fix.
const JOURNAL_LAYOUT_BEFORE =
  "flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:gap-x-8";
const JOURNAL_LAYOUT_AFTER =
  "flex flex-col gap-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:gap-x-8 lg:gap-y-12";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("section-spacing-utility", rule, {
  valid: [
    // --- the shipped fix: the layout owns the row gap ---
    { code: `<div className="${JOURNAL_LAYOUT_AFTER}" />` },

    // --- shared utility: the required form ---
    { code: `<section className="section-wide" />` },
    { code: `<section className="section-narrow border-t" />` },

    // --- not sections: no vertical rhythm, so not C3's subject ---
    // A centered lead paragraph.
    { code: `<p className="mx-auto max-w-2xl text-sm" />` },
    // A centered grid without section padding.
    { code: `<div className="grid grid-cols-2 gap-8 max-w-[840px] mx-auto" />` },
    // max-w-full / max-w-none establish no measured content width.
    { code: `<div className="mx-auto max-w-full px-6 py-16" />` },

    // --- escape hatch: same convention the audit skill documents ---
    {
      code: [
        "<>",
        "  {/* DS-exception: full-bleed hero needs its own rhythm */}",
        '  <section className="mx-auto max-w-7xl px-6 py-24" />',
        "</>",
      ].join("\n"),
    },

    // --- row spacing supplied by the container, in each accepted form ---
    { code: `<div className="flex flex-col gap-8 lg:gap-x-8" />` },
    { code: `<div className="grid grid-cols-3 space-y-4 gap-x-6" />` },
    // Not a vertical stack: a single-row flex needs no row gap.
    { code: `<div className="flex items-center gap-x-4" />` },
  ],

  invalid: [
    // --- the shipped defect: vertical stack, horizontal gap only, no row gap ---
    {
      code: `<div className="${JOURNAL_LAYOUT_BEFORE}" />`,
      errors: [{ messageId: "missingRowGap" }],
    },
    // `gap-x-8` alone must not satisfy the bare `gap-*` branch. On SP this is
    // grid-cols-1, so every child stacks at 0px.
    {
      code: `<div className="grid grid-cols-1 gap-x-8 lg:grid-cols-3" />`,
      errors: [{ messageId: "missingRowGap" }],
    },

    // --- hand-rolled section containers ---
    // Duplicates .section-wide, which is py-16 — so this had already drifted.
    {
      code: `<section className="max-w-7xl mx-auto px-6 py-24" />`,
      errors: [{ messageId: "handRolledSectionContainer" }],
    },
    // The container copied across eight legal/contact/faq pages.
    {
      code: `<div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40" />`,
      errors: [{ messageId: "handRolledSectionContainer" }],
    },
    // Fragments merged from cn() are judged as one class list.
    {
      code: `<div className={cn("mx-auto max-w-3xl", "px-6 py-20")} />`,
      errors: [{ messageId: "handRolledSectionContainer" }],
    },
  ],
});
