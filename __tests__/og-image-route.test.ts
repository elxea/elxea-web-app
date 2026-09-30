/**
 * 既定の共有カード (`/api/og-image`): 画像枠 site:social-share:og-image-01 に写真が当たって
 * いればその切り抜きを、無ければ今までの静的な画像を返す。どの場合も画像を返す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const manifest = { value: {} as Record<string, unknown> };

import { GET, OG_SLOT_ID as ROUTE_SLOT_ID, r2Only } from "@/app/api/og-image/route";
import { OG_SLOT_ID } from "@/lib/og-image";
import { R2_PUBLIC_DOMAIN, SITE_MANIFEST_URL } from "@/lib/site-assets";
import { SITE_SLOTS } from "@/lib/site-slots";

const R2_URL = `https://${R2_PUBLIC_DOMAIN}/cdn/site/ELX/site_social-share_og-image-01__og.jpg`;
const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      if (String(url) === SITE_MANIFEST_URL) return Response.json(manifest.value);
      fetched.push(String(url));
      return new Response("img", { status: 200, headers: { "content-type": "image/jpeg" } });
    }),
  );
});

describe("既定の共有カード /api/og-image", () => {
  it("枠は site-slots.manifest.json に宣言されている (1200x630・cover)", () => {
    const slot = SITE_SLOTS.find((s) => s.id === OG_SLOT_ID);
    expect(slot?.page).toBe("social-share");
    expect(slot?.surfaces.map((s) => [s.id, s.ratio.width, s.ratio.height, s.fit])).toEqual([["og", 1200, 630, "cover"]]);
  });

  it("写真が当たっていなければ静的な画像を返す", async () => {
    manifest.value = {};
    const res = await GET(new Request("https://elxea.com/api/og-image"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(fetched).toEqual(["https://elxea.com/og-image.jpg"]);
  });

  it("写真が当たっていれば、その切り抜き (R2) を返す", async () => {
    manifest.value = { [OG_SLOT_ID]: { asset_id: "AST-ELX-0001", url: R2_URL, surfaces: { og: { url: R2_URL } } } };
    const res = await GET(new Request("https://elxea.com/api/og-image"));
    expect(res.status).toBe(200);
    expect(fetched).toEqual([R2_URL]);
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("R2 以外の URL は中継しない (静的な画像に落ちる)", async () => {
    expect(r2Only("https://evil.example.com/a.jpg")).toBeNull();
    expect(r2Only("")).toBeNull();
    manifest.value = { [OG_SLOT_ID]: { asset_id: "x", url: "https://evil.example.com/a.jpg" } };
    await GET(new Request("https://elxea.com/api/og-image"));
    expect(fetched).toEqual(["https://elxea.com/og-image.jpg"]);
  });

  it("route が読む枠 id は OG_SLOT_ID と同じ", () => {
    expect(ROUTE_SLOT_ID).toBe(OG_SLOT_ID);
    const src = readFileSync(join(process.cwd(), "app/api/og-image/route.ts"), "utf8");
    expect(src).toContain(`getSiteAsset("${OG_SLOT_ID}"`);
  });
});
