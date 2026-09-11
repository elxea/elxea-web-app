import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/version/route";
import { BUILD_HEADER, getPublicBuildInfo } from "@/lib/build-info";

/**
 * `/api/version` は**認証なしで公開される**唯一の状態エンドポイント。
 * 守るべき性質は少なく、どれも「うっかり」で壊れる:
 *
 *   1. 返すキーが allowlist から増えていないこと (中身や設定値を漏らさない)
 *   2. キャッシュされないこと (古い応答を返すと「配信中の実体」を見誤る)
 *   3. SHA が無い環境では "unknown" を返すこと (適当な既定値で緑にしない)
 *
 * 新しいフィールドを足したくなったら、公開してよい値かを判断した上で
 * EXPECTED_KEYS も更新すること。ここが落ちるのは仕様変更の合図。
 */
const EXPECTED_KEYS = ["sha", "shaShort", "env"].sort();

describe("GET /api/version", () => {
  it("公開してよい状態だけを返す (キー集合が固定されている)", async () => {
    const res = GET();
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(EXPECTED_KEYS);
  });

  it("秘密や中身に類する値を含まない", async () => {
    const res = GET();
    const body = await res.json();
    const serialized = JSON.stringify(body).toLowerCase();

    for (const forbidden of ["token", "secret", "password", "session", "cookie"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("200 とキャッシュ無効ヘッダーを返す", () => {
    const res = GET();

    expect(res.status).toBe(200);
    // 本番の前段には CDN が居る。ここが緩むと「キャッシュされた昔の SHA」を見て
    // 緑にする事故が起きるため、no-store は仕様の一部。
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get(BUILD_HEADER)).toBeTruthy();
  });

  it("SHA が無い環境では unknown を返す (それらしい既定値をでっち上げない)", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    try {
      const info = getPublicBuildInfo();
      expect(info.sha).toBe("unknown");
      expect(info.shaShort).toBe("unknown");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("SHA があれば短縮形は先頭 7 桁", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    try {
      const info = getPublicBuildInfo();
      expect(info.sha).toBe("0123456789abcdef0123456789abcdef01234567");
      expect(info.shaShort).toBe("0123456");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("値はモジュール読み込み時に固定されない (第二の正本を作らない)", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "aaaaaaabbbbbbb");
    try {
      expect(getPublicBuildInfo().shaShort).toBe("aaaaaaa");
    } finally {
      vi.unstubAllEnvs();
    }

    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "cccccccddddddd");
    try {
      expect(getPublicBuildInfo().shaShort).toBe("ccccccc");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
