/**
 * 会話 ID の不可逆変換 (`lib/voice/session-id.ts`) の退行検知。
 *
 * ## 何を守るのか
 *
 * 不変条件は 1 つ:
 *
 *   **Hume に渡る文字列から、elxea 側の一次識別子が読み取れない。**
 *
 * 音声はブラウザと Hume のあいだを直接流れるので、会話を一本に保つための
 * 識別子は必ずブラウザの手を経由して外部へ出る。ここで生の会話 ID や顧客 ID が
 * 混ざると、httpOnly cookie に会話 ID を閉じ込めた意味 (「他人の会話 ID を
 * 知っているだけで読み書きできた」穴を塞いだ経緯) が丸ごと消える。
 *
 * したがってテストの形も「出力に生の値が**含まれない**」を直接書く。
 * 実装を読み替えれば通ってしまう書き方 (長さだけ見る・正規表現だけ見る) は
 * それ単体では条件を満たさないので、含有検査と併記する。
 *
 * 鍵の分離も一緒に固定する。`CHAT_SESSION_SECRET` と同じ値を入れても出力が
 * 一致しないこと (domain separation) を縛っておかないと、将来 1 本にまとめる
 * 変更が「動くから」という理由で入る。
 */
import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VOICE_SESSION_HANDLE_VERSION,
  VoiceSessionSecretMissingError,
  deriveVoiceSessionHandle,
  isVoiceSessionHandle,
} from "@/lib/voice/session-id";

/** テスト用の鍵。本物とは無関係の固定値。 */
const SECRET = "test-voice-session-secret-0123456789";

/** 実際の `resolveChatSession()` が返す形 (bare UUID)。 */
const SESSION_ID = "7f3a9c41-2b8e-4d6a-9f10-5c2e8b7a1d43";
/** Shopify の顧客 ID。会話 ID とは別系統の、絶対に外へ出してはいけない値。 */
const CUSTOMER_GID = "gid://shopify/Customer/8123456789012";

function withSecret(value: string | undefined): void {
  if (value === undefined) {
    vi.stubEnv("VOICE_SESSION_SECRET", "");
    return;
  }
  vi.stubEnv("VOICE_SESSION_SECRET", value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deriveVoiceSessionHandle", () => {
  it("生の会話 ID を出力に含めない", () => {
    withSecret(SECRET);
    const handle = deriveVoiceSessionHandle(SESSION_ID);

    expect(handle).not.toContain(SESSION_ID);
    /* UUID をハイフンで割った断片も出さない。「一部だけ残る」実装 (前方一致の
       接頭辞を付けてしまう等) をここで落とす。 */
    for (const chunk of SESSION_ID.split("-")) {
      expect(handle).not.toContain(chunk);
    }
    /* ハイフンを抜いた形・大文字化した形でも当たらない。 */
    expect(handle).not.toContain(SESSION_ID.replace(/-/g, ""));
    expect(handle.toLowerCase()).not.toContain(SESSION_ID.toLowerCase());
  });

  it("生の顧客 ID を出力に含めない", () => {
    withSecret(SECRET);
    /* 顧客 ID が会話 ID として渡ってしまう配線ミスが起きても、出力に生の値が
       出ないことを縛る (変換の入力が何であれ一方向であることの確認)。 */
    const handle = deriveVoiceSessionHandle(CUSTOMER_GID);

    expect(handle).not.toContain(CUSTOMER_GID);
    expect(handle).not.toContain("8123456789012");
    expect(handle).not.toContain("shopify");
    expect(handle.toLowerCase()).not.toContain("customer");
  });

  it("復元できる情報を持たない形 (v1: + base64url 43 文字) で返す", () => {
    withSecret(SECRET);
    const handle = deriveVoiceSessionHandle(SESSION_ID);

    expect(handle.startsWith(`${VOICE_SESSION_HANDLE_VERSION}:`)).toBe(true);
    expect(handle).toMatch(/^v1:[A-Za-z0-9_-]{43}$/);
    /* base64url なので `=` パディング・`+` `/` は出ない (URL / ヘッダに
       無加工で載せられる形)。 */
    expect(handle).not.toContain("=");
    expect(handle).not.toContain("+");
    expect(handle).not.toContain("/");
    expect(isVoiceSessionHandle(handle)).toBe(true);
  });

  it("同じ鍵・同じ会話なら毎回同じ (会話が続くあいだ handle が変わらない)", () => {
    withSecret(SECRET);
    expect(deriveVoiceSessionHandle(SESSION_ID)).toBe(deriveVoiceSessionHandle(SESSION_ID));
  });

  it("会話が違えば handle も違う", () => {
    withSecret(SECRET);
    const other = "11111111-2222-4333-8444-555555555555";
    expect(deriveVoiceSessionHandle(SESSION_ID)).not.toBe(deriveVoiceSessionHandle(other));
  });

  it("鍵が違えば handle も違う (鍵を持たない者は同じ handle を作れない)", () => {
    withSecret(SECRET);
    const mine = deriveVoiceSessionHandle(SESSION_ID);

    withSecret("some-other-secret-that-is-not-ours");
    expect(deriveVoiceSessionHandle(SESSION_ID)).not.toBe(mine);
  });

  it("チャット用の鍵と同値でも出力が一致しない (鍵の共用を禁じる)", () => {
    /* 運用ミスで両方に同じ文字列が入っても、cookie の署名と handle が
       同じ値にならないこと。入力側のラベル (domain separation) が効いている
       ことの確認で、これが崩れると「鍵を 1 本にまとめてよい」に見えてしまう。 */
    withSecret(SECRET);
    vi.stubEnv("CHAT_SESSION_SECRET", SECRET);

    const handle = deriveVoiceSessionHandle(SESSION_ID);
    const chatSignature = crypto
      .createHmac("sha256", SECRET)
      .update(SESSION_ID, "utf8")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(handle).not.toContain(chatSignature);
  });

  it("鍵が無いときは handle を作らずに落とす (無言で劣化させない)", () => {
    withSecret(undefined);
    expect(() => deriveVoiceSessionHandle(SESSION_ID)).toThrow(VoiceSessionSecretMissingError);
  });

  it("鍵が無いときの例外メッセージにも会話 ID を出さない", () => {
    withSecret(undefined);
    try {
      deriveVoiceSessionHandle(SESSION_ID);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceSessionSecretMissingError);
      expect((err as Error).message).not.toContain(SESSION_ID);
    }
  });
});

describe("isVoiceSessionHandle", () => {
  it("handle でないものを受け付けない", () => {
    expect(isVoiceSessionHandle(SESSION_ID)).toBe(false);
    expect(isVoiceSessionHandle(`v2:${"a".repeat(43)}`)).toBe(false);
    expect(isVoiceSessionHandle(`v1:${"a".repeat(42)}`)).toBe(false);
    expect(isVoiceSessionHandle(undefined)).toBe(false);
    expect(isVoiceSessionHandle(null)).toBe(false);
    expect(isVoiceSessionHandle(123)).toBe(false);
  });
});
