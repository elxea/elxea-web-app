/**
 * Tests for LIFF ID token server-side verification (案A: LINE×Shopify 連携).
 *
 * verifyLiffIdToken の契約:
 *   - fail-closed: channelId 未設定 / idToken 空 → 失敗
 *   - LINE verify が非 200 → 失敗
 *   - aud（宛先チャネル）不一致 → 失敗（他チャネル向けトークンの流用を弾く）
 *   - iss（発行者）が LINE でない → 失敗（QA S-2 対応・docstring 要件の実チェック化）
 *   - exp（有効期限）が過去 → 失敗（LINE verify 前提でも自前でも弾く多層防御）
 *   - sub が Messaging userId 形式でない → 失敗
 *   - すべて満たす → messagingUserId(sub) を返す
 *
 * ネットワークには触れず、fetch をスタブして LINE verify の応答を再現する。
 */
import { describe, it, expect, vi } from "vitest";
import { verifyLiffIdToken } from "@/lib/line/verify-liff-token";

const CHANNEL_ID = "2000000001";
const VALID_SUB = "U0123456789abcdef0123456789abcdef"; // U + 32 hex
const VALID_TOKEN = "a".repeat(40); // 形式は LINE verify に委ねるので中身は不問
const LINE_ISS = "https://access.line.me"; // LINE ID トークンの発行者（固定値）
const FUTURE_EXP = 9999999999; // 期限切れでない遠い未来

function stubFetch(status: number, jsonBody: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  })) as unknown as typeof fetch;
}

describe("verifyLiffIdToken", () => {
  it("channelId 未設定 → fail-closed", async () => {
    const res = await verifyLiffIdToken(VALID_TOKEN, undefined, stubFetch(200, {}));
    expect(res.ok).toBe(false);
  });

  it("idToken 空 → 失敗", async () => {
    const res = await verifyLiffIdToken("", CHANNEL_ID, stubFetch(200, {}));
    expect(res.ok).toBe(false);
  });

  it("LINE verify が 400（署名不正・期限切れ等）→ 失敗", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(400, { error: "invalid_request" }),
    );
    expect(res.ok).toBe(false);
  });

  it("aud 不一致 → 失敗（他チャネル向けトークンの流用を弾く）", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, { sub: VALID_SUB, aud: "9999999999", exp: 9999999999 }),
    );
    expect(res.ok).toBe(false);
  });

  it("iss が LINE でない → 失敗（発行者すり替えを弾く・QA S-2）", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, { sub: VALID_SUB, aud: CHANNEL_ID, iss: "https://evil.example", exp: FUTURE_EXP }),
    );
    expect(res.ok).toBe(false);
  });

  it("exp が過去 → 失敗（期限切れトークンの流用を弾く）", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, { sub: VALID_SUB, aud: CHANNEL_ID, iss: LINE_ISS, exp: 1000000000 }),
    );
    expect(res.ok).toBe(false);
  });

  it("sub が Messaging userId 形式でない → 失敗", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, { sub: "not-a-user-id", aud: CHANNEL_ID, iss: LINE_ISS, exp: FUTURE_EXP }),
    );
    expect(res.ok).toBe(false);
  });

  it("正当なトークン → messagingUserId(sub) を返す", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, {
        sub: VALID_SUB,
        aud: CHANNEL_ID,
        iss: LINE_ISS,
        exp: FUTURE_EXP,
        email: "buyer@example.com",
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.messagingUserId).toBe(VALID_SUB);
      expect(res.email).toBe("buyer@example.com");
    }
  });

  it("email 無し → email は null（サブジェクトは有効）", async () => {
    const res = await verifyLiffIdToken(
      VALID_TOKEN,
      CHANNEL_ID,
      stubFetch(200, { sub: VALID_SUB, aud: CHANNEL_ID, iss: LINE_ISS, exp: FUTURE_EXP }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.email).toBe(null);
  });

  it("fetch が throw → 失敗（例外を握って fail-closed）", async () => {
    const throwingFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await verifyLiffIdToken(VALID_TOKEN, CHANNEL_ID, throwingFetch);
    expect(res.ok).toBe(false);
  });
});
