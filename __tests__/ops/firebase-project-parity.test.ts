/**
 * E6' — 2 リポの Firebase 接続先契約の突合が「通すべきときだけ通る」ことを固定する。
 *
 * ## なぜここを固定するのか
 *
 * この検査の価値は **未設定・到達不能を緑にしないこと** に尽きる。
 * cx-agent には Firebase 未設定でも黙って動き続けられる縮退が各所にあり、
 * 「設定されているのかいないのかを外から言えない」状態が実際に長く続いた。
 * その誤読が persona 二重加算の見落としに直結している。
 *
 * だから通すのは 1 パターンだけ (200 + configured=true + project_id が一致) で、
 * それ以外は全部落とす。ここが緩むと、この検査は「壊れているときだけ何も言わない」
 * 検査になる — 最悪の壊れ方で、しかも緑なので誰も気づかない。
 *
 * 判定は純関数なのでネットワーク無しで全分岐を通せる。
 */
import { describe, expect, it } from "vitest";

import {
  evaluateFirebaseParity,
  readDefaultProjectId,
} from "../../scripts/ops/lib/firebase-project-parity.mjs";

const BASE = {
  expectedProjectId: "elxea-ec",
  healthUrl: "https://cx.example.invalid/health/firebase",
  status: 200 as number | null,
  body: { service: "elxea-agent", configured: true, project_id: "elxea-ec" } as unknown,
  error: null as string | null,
};

describe("evaluateFirebaseParity", () => {
  it("一致していれば通る (通るのはこの 1 パターンだけ)", () => {
    const v = evaluateFirebaseParity(BASE);
    expect(v.verdict).toBe("ok");
    expect(v.reason).toBe("match");
  });

  it("接続先が食い違っていたら落ちる — 本文に両方の値を出す", () => {
    const v = evaluateFirebaseParity({
      ...BASE,
      body: { configured: true, project_id: "elxea-cx-agent-staging" },
    });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("mismatch");
    // どちらが何を見ているかが分からないと直せない。
    expect(v.message).toContain("elxea-ec");
    expect(v.message).toContain("elxea-cx-agent-staging");
  });

  it("cx-agent が未設定を申告していたら落ちる (未設定を緑にしない)", () => {
    const v = evaluateFirebaseParity({
      ...BASE,
      status: 503,
      body: { configured: false, project_id: null },
    });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("http_503");
    expect(v.message, "本番設定が壊れている側だと分かる文言であること").toContain("未設定");
  });

  it("200 でも configured=false なら落ちる", () => {
    const v = evaluateFirebaseParity({
      ...BASE,
      body: { configured: false, project_id: null },
    });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("cx_agent_unconfigured");
  });

  it("200 でも project_id が空文字なら落ちる", () => {
    const v = evaluateFirebaseParity({
      ...BASE,
      body: { configured: true, project_id: "" },
    });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("cx_agent_unconfigured");
  });

  it("口がまだ無い (404) なら落ちる — 契約の片側が未デプロイ", () => {
    const v = evaluateFirebaseParity({ ...BASE, status: 404, body: null });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("http_404");
    expect(v.message, "何をすればよいかが書いてあること").toContain("デプロイ");
  });

  it("到達できなければ落ちる (確かめられない = 緑にしない)", () => {
    const v = evaluateFirebaseParity({
      ...BASE,
      status: null,
      body: null,
      error: "fetch failed",
    });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("unreachable");
  });

  it("200 でも本文が JSON でなければ落ちる (ステータスだけ見る検査は騙される)", () => {
    const v = evaluateFirebaseParity({ ...BASE, body: null });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("body_not_json");
  });

  it("突合先 URL が未設定なら落ちる (何も検査していない状態を緑にしない)", () => {
    const v = evaluateFirebaseParity({ ...BASE, healthUrl: null });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("health_url_unset");
  });

  it(".firebaserc を読めなければ落ちる (読めないほうだけ緑になる経路を作らない)", () => {
    const v = evaluateFirebaseParity({ ...BASE, expectedProjectId: null });
    expect(v.verdict).toBe("fail");
    expect(v.reason).toBe("firebaserc_missing");
  });
});

describe("readDefaultProjectId", () => {
  it("実際の .firebaserc の形から projects.default を取り出す", () => {
    expect(readDefaultProjectId('{"projects":{"default":"elxea-ec"}}')).toBe("elxea-ec");
  });

  it("壊れた JSON は null (例外にしない — 判定側で落とす形に揃える)", () => {
    expect(readDefaultProjectId("{not json")).toBe(null);
  });

  it("projects.default が無い / 空なら null", () => {
    expect(readDefaultProjectId("{}")).toBe(null);
    expect(readDefaultProjectId('{"projects":{}}')).toBe(null);
    expect(readDefaultProjectId('{"projects":{"default":""}}')).toBe(null);
  });
});
