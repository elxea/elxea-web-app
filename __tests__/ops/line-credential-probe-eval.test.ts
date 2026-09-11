/**
 * 監視が `/api/health/line` の答えをどう読むかを固定する。
 *
 * ## なぜここを固定するのか
 *
 * 監視の価値は「鳴るべきときに鳴り、鳴るべきでないときに黙る」ことに尽きる。
 * 片方でも崩れると監視は無視されるようになり、そのとき既存の検知も一緒に死ぬ。
 *
 * 特に境界が 2 つある:
 *
 *   1. **`unknown` を critical にしない。** LINE に到達できなかっただけの回で
 *      「設定が壊れた」と鳴らすと、LINE 側の一時的な不調のたびに Issue が立つ。
 *   2. **判定を読めなかった応答を緑にしない。** ステータスが 200 でも、本文が
 *      JSON でなければサイトパスワードの門や CDN のエラーページが前に出ている。
 *      ステータスだけ見る監視はここで必ず騙される (既存の probe が
 *      `expectedLocationHost` を見ているのと同じ理由)。
 */
import { describe, expect, it } from "vitest";

import { evaluateCredentialProbe } from "../../scripts/ops/lib/line-log-monitor.mjs";

const PROBE = {
  name: "line-credentials",
  path: "/api/health/line",
  description: "LINE のチャネル資格情報が受理されること",
};

const channels = (login: string, link: string) => ({
  login: { verdict: login, detail: `${login} detail` },
  link: { verdict: link, detail: `${link} detail` },
});

describe("evaluateCredentialProbe", () => {
  it("status=ok なら何も返さない (鳴らない)", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 200,
      json: { status: "ok", channels: channels("ok", "ok") },
      error: null,
    });
    expect(finding).toBeNull();
  });

  it("status=misconfigured は critical で、どちらのチャネルかを本文に出す", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 503,
      json: { status: "misconfigured", channels: channels("misconfigured", "ok") },
      error: null,
    });
    expect(finding!.severity).toBe("critical");
    expect(finding!.reason).toContain("invalid_client");
    /* 内訳が無いと、Issue を見た人が「ログインか連携か」を当てに行く羽目になる。 */
    expect(finding!.reason).toContain("login=misconfigured");
    expect(finding!.reason).toContain("link=ok");
  });

  it("status=not-configured も critical (このデプロイでは LINE が動かない)", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 503,
      json: { status: "not-configured", channels: channels("not-configured", "ok") },
      error: null,
    });
    expect(finding!.severity).toBe("critical");
  });

  it("status=unknown は error に留める (LINE 側の不調で critical にしない)", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 502,
      json: { status: "unknown", channels: channels("unknown", "unknown") },
      error: null,
    });
    expect(finding!.severity).toBe("error");
  });

  it("到達できなければ error で上げる (黙らない)", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: null,
      json: null,
      error: "TimeoutError",
    });
    expect(finding!.severity).toBe("error");
    expect(finding!.reason).toContain("TimeoutError");
  });

  it("200 でも JSON でなければ緑にしない", () => {
    /* サイトパスワードの門・CDN のエラーページ・別ルートへの取り違えは、
       どれも「200 だが判定が入っていない」形で現れる。 */
    const finding = evaluateCredentialProbe(PROBE, { status: 200, json: null, error: null });
    expect(finding!.severity).toBe("error");
    expect(finding!.reason).toContain("判定を読めなかった");
  });

  it("知らない判定語も緑にしない", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 200,
      json: { status: "something-new" },
      error: null,
    });
    expect(finding).not.toBeNull();
  });

  it("内訳が無くても落ちない", () => {
    const finding = evaluateCredentialProbe(PROBE, {
      status: 503,
      json: { status: "misconfigured" },
      error: null,
    });
    expect(finding!.severity).toBe("critical");
    expect(finding!.reason).toContain("(内訳なし)");
  });
});
