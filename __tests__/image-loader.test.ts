import { describe, expect, it, vi } from "vitest";

import { IMAGE_REMOTE_PATTERNS } from "@/lib/image-hosts";
import loader, { REJECTED_IMAGE_FALLBACK } from "@/lib/image-loader";
import { sanitizeImageUrl } from "@/lib/image-utils";

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

});

describe("elxeaImageLoader allowlist (lib/image-hosts.ts と共有)", () => {
  it("allowlist 外のホストは素通しせず placeholder に落とす (console.error 付き)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(loader({ src: "https://example.com/a.jpg", width: 640 })).toBe(
        REJECTED_IMAGE_FALLBACK,
      );
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/allowlist 外/);
    } finally {
      err.mockRestore();
    }
  });

  it("http: (非 https) は allowlist 内ホストでも拒否する", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(loader({ src: "http://cdn.shopify.com/s/files/1/a.jpg", width: 640 })).toBe(
        REJECTED_IMAGE_FALLBACK,
      );
    } finally {
      err.mockRestore();
    }
  });

  it("*.shopify.com の 1 段ワイルドカードは通る", () => {
    const out = loader({ src: "https://images.shopify.com/cdn/a.jpg", width: 320 });
    expect(new URL(out).searchParams.get("width")).toBe("320");
  });

  it("next.config remotePatterns と sanitizeImageUrl が同じ allowlist を見る", () => {
    expect(IMAGE_REMOTE_PATTERNS.map((p) => p.hostname)).toEqual([
      "cdn.shopify.com",
      "*.shopify.com",
      "cdn.sanity.io",
      "pub-90a0485599904fee8228ef56bb51c2e6.r2.dev",
    ]);
    expect(sanitizeImageUrl("https://example.com/a.jpg")).toBeNull();
    expect(
      sanitizeImageUrl("https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/x.jpg"),
    ).not.toBeNull();
  });
});
