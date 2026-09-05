import { describe, expect, it } from "vitest";

import { getProfileSource } from "@/lib/profile/source";

/**
 * `lib/profile/source.ts` は `import "server-only"` を持つ。本物の `server-only`
 * は Next のバンドラの条件解決だけを前提に無害化されるため、Vitest 単体では
 * `vitest.config.ts` の `resolve.alias` でシム (`__tests__/helpers/server-only-empty.ts`)
 * に差し替えている。この差し替えが壊れると `lib/profile/**` の他のテスト
 * (parity / anonymity / performance-budget) が軒並み import エラーで落ちる —
 * その原因がここに固定されていることを最初に検査する。
 */
describe("lib/profile/source.ts is importable under Vitest (server-only shim)", () => {
  it("throw せずに import でき、関数として呼び出せる", () => {
    expect(typeof getProfileSource).toBe("function");
  });
});
