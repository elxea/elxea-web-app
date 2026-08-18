import { describe, it, expect } from "vitest";

import { buttonVariants } from "@/components/ui/button";

/**
 * Machine assertion for the Button padding / centering contract.
 *
 * Design regression guard: buttons must keep their label optically centered.
 * We assert the *class contract* (static, fast, no DOM needed) rather than
 * computed styles so this runs in the node unit project and fails CI the
 * moment someone breaks the invariant.
 *
 * Invariants enforced:
 *  1. Base classes center content on both axes (items-center + justify-center).
 *  2. No size introduces ASYMMETRIC vertical padding (split pt / pb), which
 *     would push the text off the vertical center.
 *  3. The default size keeps symmetric vertical padding (py-*).
 */

const SIZES = [
  "default",
  "xs",
  "sm",
  "lg",
  // 本レーン (C7-1) で追加した size のみを足した。既存 size の網羅範囲は
  // 変えていない (`service` の網羅追加は DS トークン整合タスクへ申し送り)。
  "cta",
  "icon",
  "icon-xs",
  "icon-sm",
  "icon-lg",
] as const;

describe("Button padding/centering contract (machine gate)", () => {
  it("base classes center content on both axes", () => {
    const cls = buttonVariants({});
    expect(cls, `expected vertical centering in: ${cls}`).toContain(
      "items-center",
    );
    expect(cls, `expected horizontal centering in: ${cls}`).toContain(
      "justify-center",
    );
  });

  for (const size of SIZES) {
    it(`size='${size}' has no asymmetric vertical padding`, () => {
      const cls = buttonVariants({ size });
      // Reject split pt-*/pb-* (asymmetric). Symmetric padding uses py-*.
      const hasSplitTop = /(?:^|\s)pt-\S/.test(cls);
      const hasSplitBottom = /(?:^|\s)pb-\S/.test(cls);
      expect(hasSplitTop, `unexpected pt-* (asymmetric) in: ${cls}`).toBe(false);
      expect(hasSplitBottom, `unexpected pb-* (asymmetric) in: ${cls}`).toBe(
        false,
      );
    });
  }

  it("default size uses symmetric py padding", () => {
    const cls = buttonVariants({ size: "default" });
    expect(cls, `expected symmetric py-* in: ${cls}`).toMatch(/(?:^|\s)py-\d/);
  });
});
