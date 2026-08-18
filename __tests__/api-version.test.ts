import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/version/route";
import { getPublicBuildInfo, BUILD_HEADER } from "@/lib/build-info";

/**
 * `/api/version` は**認証なしで公開される**唯一の状態エンドポイント。
 * ここが守るべき性質は 2 つだけで、どちらも「うっかり」で壊れる:
 *
 *   1. 返すキーが allowlist から増えていないこと (中身や設定値を漏らさない)
 *   2. キャッシュされないこと (古い応答を返すと「配信中の実体」を見誤る)
 *
 * 新しいフィールドを足したくなったら、公開してよい値かを判断した上で
 * EXPECTED_KEYS も更新すること。ここが落ちるのは仕様変更の合図。
 */
const EXPECTED_KEYS = ["sha", "shaShort", "builtAt", "env", "deploymentId"].sort();

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
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("ページ側と同じビルド識別ヘッダーを付ける", () => {
    const res = GET();

    expect(res.headers.get(BUILD_HEADER)).toBe(getPublicBuildInfo().shaShort);
  });

  it("値が取れないときは黙って空にせず unknown を返す (検証側が fail-closed にできる)", () => {
    const info = getPublicBuildInfo();

    for (const value of Object.values(info)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
