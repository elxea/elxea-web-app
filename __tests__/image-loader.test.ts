import { describe, expect, it } from "vitest";

import loader from "@/lib/image-loader";

describe("elxeaImageLoader (Vercel 画像変換バイパス)", () => {
  it("ローカル静的パスはそのまま返す (/_next/image を組み立てない)", () => {
    expect(loader({ src: "/placeholder-hero-day.jpg", width: 828 })).toBe(
      "/placeholder-hero-day.jpg",
    );
    expect(loader({ src: "data:image/png;base64,AAAA", width: 64 })).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("Shopify CDN は width= を付け、既存クエリ (v=) を保つ", () => {
    const src = "https://cdn.shopify.com/s/files/1/0001/files/main.jpg?v=1700000000";
    const out = new URL(loader({ src, width: 1080 }));
    expect(out.hostname).toBe("cdn.shopify.com");
    expect(out.searchParams.get("width")).toBe("1080");
    expect(out.searchParams.get("v")).toBe("1700000000");
    expect(out.toString()).not.toContain("/_next/image");
  });

  it("Shopify CDN の width= は候補幅ごとに上書きされる (srcSet 各段が別 URL)", () => {
    const src = "https://cdn.shopify.com/s/files/1/0001/files/main.jpg?width=200";
    expect(new URL(loader({ src, width: 640 })).searchParams.get("width")).toBe("640");
  });

  it("Sanity は w= を差し替え、h= を同じ比率で追随させる", () => {
    const src = "https://cdn.sanity.io/images/p/d/abc-1200x800.jpg?w=600&h=400";
    const out = new URL(loader({ src, width: 1200, quality: 75 }));
    expect(out.searchParams.get("w")).toBe("1200");
    expect(out.searchParams.get("h")).toBe("800");
    expect(out.searchParams.get("auto")).toBe("format");
    expect(out.searchParams.get("q")).toBe("75");
  });

  it("Sanity で h= が無ければ幅だけ差し替える", () => {
    const src = "https://cdn.sanity.io/images/p/d/abc-1200x800.jpg?w=1440";
    const out = new URL(loader({ src, width: 750 }));
    expect(out.searchParams.get("w")).toBe("750");
    expect(out.searchParams.has("h")).toBe(false);
  });

  it("R2 の site slot 画像 (面別に焼き済み) はそのまま返す", () => {
    const src =
      "https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/ELX/top-hero__pc.jpg";
    expect(loader({ src, width: 1920 })).toBe(src);
  });

  it("未知のホストはそのまま返す (Vercel を通さない)", () => {
    const src = "https://example.com/a.jpg";
    expect(loader({ src, width: 640 })).toBe(src);
  });
});
