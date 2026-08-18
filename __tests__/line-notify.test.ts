/**
 * Tests for `sendLineNotify` (運営宛 LINE push の送信層).
 *
 * この関数が守るべき契約:
 *   1. 認証情報 (LINE_CHANNEL_ACCESS_TOKEN / LINE_ADMIN_USER_ID) が揃っていなければ
 *      **送信せず黙って戻る** (未設定の環境で本処理を落とさないための設計)。
 *      「揃っていない」は片方だけ欠けている場合も含む。
 *   2. 揃っていれば LINE push API へ 1 回だけ POST し、Bearer と宛先・本文を正しく積む。
 *      認証情報は毎回 process.env から読む (module ロード時のスナップショットではない)。
 *   3. LINE 側が非 2xx を返しても **throw しない** (呼び出し元の本処理を壊さない)。
 *   4. fetch 自体が reject しても throw しない。
 *
 * **実送信はしない**。fetch はスタブし、outbound の内容だけを観測する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { sendLineNotify } from "@/lib/line/notify";

const PUSH_API = "https://api.line.me/v2/bot/message/push";
const TOKEN = "test-channel-access-token";
const ADMIN_USER_ID = "U00000000000000000000000000000000";

let fetchMock: ReturnType<typeof vi.fn>;

/** outbound の 1 回目の body を JSON として取り出す。 */
function outboundBody(): { to: string; messages: { type: string; text: string }[] } {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  process.env.LINE_CHANNEL_ACCESS_TOKEN = TOKEN;
  process.env.LINE_ADMIN_USER_ID = ADMIN_USER_ID;

  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_ADMIN_USER_ID;
});

describe("認証情報が揃っていないとき", () => {
  it("両方未設定なら送信しない", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_ADMIN_USER_ID;

    await sendLineNotify({ subject: "件名", body: "本文" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("トークンだけ欠けていても送信しない", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

    await sendLineNotify({ subject: "件名", body: "本文" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("宛先だけ欠けていても送信しない", async () => {
    delete process.env.LINE_ADMIN_USER_ID;

    await sendLineNotify({ subject: "件名", body: "本文" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("認証情報が揃っているとき", () => {
  it("push API へ 1 回 POST し、Bearer と宛先・本文を積む", async () => {
    await sendLineNotify({ subject: "件名", body: "本文", level: "error" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PUSH_API);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    const body = outboundBody();
    expect(body.to).toBe(ADMIN_USER_ID);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.type).toBe("text");
    expect(body.messages[0]!.text).toContain("件名");
    expect(body.messages[0]!.text).toContain("本文");
  });

  it("認証情報は呼び出しごとに読む (差し替えが次の呼び出しに効く)", async () => {
    process.env.LINE_ADMIN_USER_ID = "U11111111111111111111111111111111";

    await sendLineNotify({ subject: "件名", body: "本文" });

    expect(outboundBody().to).toBe("U11111111111111111111111111111111");
  });

  it("level ごとに見出しの記号が変わる (既定は info)", async () => {
    await sendLineNotify({ subject: "件名", body: "本文" });
    const infoText = outboundBody().messages[0]!.text;

    fetchMock.mockClear();
    await sendLineNotify({ subject: "件名", body: "本文", level: "error" });
    const errorText = outboundBody().messages[0]!.text;

    expect(infoText).not.toBe(errorText);
  });
});

describe("送信が失敗したとき本処理を壊さない", () => {
  it("LINE が 400 を返しても throw しない", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"message":"Invalid to"}',
    });

    await expect(
      sendLineNotify({ subject: "件名", body: "本文" }),
    ).resolves.toBeUndefined();
  });

  it("fetch が reject しても throw しない", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(
      sendLineNotify({ subject: "件名", body: "本文" }),
    ).resolves.toBeUndefined();
  });
});
