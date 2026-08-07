import { describe, expect, it } from "vitest";

import { decodeHandle } from "@/lib/handle";

describe("decodeHandle", () => {
  it("percent-encode された日本語ハンドルを decode する", () => {
    expect(decodeHandle("%E7%85%8E%E8%8C%B6")).toBe("煎茶");
  });

  it("decode 済みの日本語ハンドルはそのまま返す (冪等)", () => {
    expect(decodeHandle("煎茶")).toBe("煎茶");
    expect(decodeHandle(decodeHandle("%E7%85%8E%E8%8C%B6"))).toBe("煎茶");
  });

  it("ASCII ハンドルは変化しない", () => {
    expect(decodeHandle("premium-sencha")).toBe("premium-sencha");
  });

  it("decode 不能な不正 % 混じりは元の値を返す (throw しない)", () => {
    expect(decodeHandle("100%-organic")).toBe("100%-organic");
    expect(decodeHandle("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("空文字を許容する", () => {
    expect(decodeHandle("")).toBe("");
  });

  it("複数セグメントの混在 encode を decode する", () => {
    expect(decodeHandle("%E6%8A%B9%E8%8C%B6-latte")).toBe("抹茶-latte");
  });
});
