/**
 * 会話 ID の署名 (`lib/chat/session-token.ts`) の退行検知。
 *
 * ## 何を固定するのか
 *
 * ここで守る不変条件は 1 つだけ:
 *
 *   **鍵を持たない者は、有効なトークンを作れない。**
 *
 * 会話 ID (UUID) 自体は秘密ではない。URL・ログ・共用端末・総当たりのどれからでも
 * 漏れうる。この変更の前は「他人の会話 ID を知っている」だけで、その会話を読む・
 * 書き込む・自分の LINE に恒久的に結び付けることができた (経緯は被テスト module の
 * 冒頭)。したがってテストの形も「知っていても作れない」を直接書く。
 *
 * fail-closed であることも一緒に固定する。形が違う・署名が合わない・鍵が無い、
 * どの理由でも答えは `null` の 1 つで、「読めなかったので中身を信じる」経路は無い。
 */
import { describe, expect, it } from "vitest";

import {
  buildSessionToken,
  isBareSessionId,
  parseSessionToken,
  sessionCookieValue,
  signSessionId,
} from "@/lib/chat/session-token";

/** テスト用の鍵。本物とは無関係の固定値。 */
const SECRET = "test-chat-session-secret-0123456789";
/** 攻撃者が持っている「別の鍵」。総当たりでも推測でも、要は本物ではない鍵。 */
const OTHER_SECRET = "attacker-guessed-secret-0123456789";

const SESSION_ID = "8f14e45f-ea8f-4b1e-9c2b-3a7d5f0e1a22";
/** 「被害者の会話 ID を知っている」状況を表す値。 */
const VICTIM_SESSION_ID = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

describe("署名の往復", () => {
  it("署名したトークンは同じ UUID に戻る", () => {
    const token = buildSessionToken(SESSION_ID, SECRET);
    const parsed = parseSessionToken(token, SECRET);

    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe(SESSION_ID);
  });

  it("session_id は署名を混ぜず bare UUID のまま返る (cx-agent の DB の主キー)", () => {
    /* ここが崩れると、既に保存されている会話が全部別 ID として扱われ迷子になる。
       署名は必ず別フィールド (`proof`) で運ぶ。 */
    const parsed = parseSessionToken(buildSessionToken(SESSION_ID, SECRET), SECRET);

    expect(parsed?.sessionId).toBe(SESSION_ID);
    expect(parsed?.sessionId).not.toContain(".");
    expect(parsed?.proof).toBe(signSessionId(SESSION_ID, SECRET));
  });

  it("署名は base64url (URL とクエリにそのまま載る形)", () => {
    const proof = signSessionId(SESSION_ID, SECRET);

    expect(proof).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(proof).not.toContain("+");
    expect(proof).not.toContain("/");
    expect(proof).not.toContain("=");
  });

  it("同じ入力なら同じ署名 / 違う UUID なら違う署名", () => {
    expect(signSessionId(SESSION_ID, SECRET)).toBe(signSessionId(SESSION_ID, SECRET));
    expect(signSessionId(SESSION_ID, SECRET)).not.toBe(
      signSessionId(VICTIM_SESSION_ID, SECRET),
    );
  });

  it("鍵の前後の空白は無視する (貼り付け由来の改行で検証が落ちない)", () => {
    const token = buildSessionToken(SESSION_ID, SECRET);
    expect(parseSessionToken(token, `  ${SECRET}\n`)).not.toBeNull();
  });
});

describe("他人の会話 ID を知っていても、鍵が無ければ有効なトークンは作れない", () => {
  it("被害者の UUID を別の鍵で署名しても通らない", () => {
    /* 攻撃者は被害者の会話 ID を知っている、という前提。それでも本物の鍵が
       無ければ、サーバが受け付けるトークンは組み立てられない。 */
    const forged = buildSessionToken(VICTIM_SESSION_ID, OTHER_SECRET);

    expect(parseSessionToken(forged, SECRET)).toBeNull();
  });

  it("被害者の UUID を署名なしで出しても通らない", () => {
    expect(parseSessionToken(VICTIM_SESSION_ID, SECRET)).toBeNull();
  });

  it("被害者の UUID に適当な署名を付けても通らない", () => {
    expect(parseSessionToken(`${VICTIM_SESSION_ID}.AAAA`, SECRET)).toBeNull();
  });

  it("有効なトークンの UUID だけを被害者のものに差し替えても通らない", () => {
    // 署名は「その UUID に対して」作られている。中身を差し替えれば必ず合わなくなる。
    const mine = buildSessionToken(SESSION_ID, SECRET);
    const proof = mine.split(".")[1];

    expect(parseSessionToken(`${VICTIM_SESSION_ID}.${proof}`, SECRET)).toBeNull();
  });

  it("署名を 1 文字だけ書き換えても通らない", () => {
    const token = buildSessionToken(SESSION_ID, SECRET);
    const [id, proof] = token.split(".");
    const flipped = (proof[0] === "A" ? "B" : "A") + proof.slice(1);

    expect(parseSessionToken(`${id}.${flipped}`, SECRET)).toBeNull();
  });

  it("署名を切り詰めても通らない (長さ違いで比較前に落ちる)", () => {
    const token = buildSessionToken(SESSION_ID, SECRET);
    const [id, proof] = token.split(".");

    expect(parseSessionToken(`${id}.${proof.slice(0, -1)}`, SECRET)).toBeNull();
    expect(parseSessionToken(`${id}.${proof}A`, SECRET)).toBeNull();
  });
});

describe("fail-closed (読めなかったら必ず null)", () => {
  it("鍵が未設定なら、正しく署名されたトークンでも受け付けない", () => {
    const token = buildSessionToken(SESSION_ID, SECRET);

    expect(parseSessionToken(token, undefined)).toBeNull();
    expect(parseSessionToken(token, null)).toBeNull();
    expect(parseSessionToken(token, "")).toBeNull();
    expect(parseSessionToken(token, "   \n")).toBeNull();
  });

  it("トークンが無い・空でも例外にせず null", () => {
    expect(parseSessionToken(undefined, SECRET)).toBeNull();
    expect(parseSessionToken(null, SECRET)).toBeNull();
    expect(parseSessionToken("", SECRET)).toBeNull();
  });

  it("形が違うものは全部 null", () => {
    const proof = signSessionId(SESSION_ID, SECRET);
    const cases = [
      SESSION_ID, // 署名が無い
      `${SESSION_ID}.`, // 署名が空
      `.${proof}`, // UUID が空
      `${SESSION_ID}.${proof}.${proof}`, // 区切りが 2 つ
      `not-a-uuid.${proof}`, // UUID の形ではない
      `${SESSION_ID.toUpperCase().replace(/-/g, "")}.${proof}`, // ハイフン無し
      `${SESSION_ID}:${proof}`, // 別の区切り
      "   ",
    ];

    for (const token of cases) {
      expect(parseSessionToken(token, SECRET), `通ってはいけない: ${token}`).toBeNull();
    }
  });

  it("v4 でない UUID は、署名が正しくても受け付けない", () => {
    /* 形の門番をこちら側に置く。cx-agent はこの値をそのまま DB のキーにするので、
       鍵の運用を誤った瞬間に任意の文字列が主キーとして流れ込むのを防ぐ。 */
    const v1Shaped = "8f14e45f-ea8f-1b1e-9c2b-3a7d5f0e1a22";
    const token = `${v1Shaped}.${signSessionId(v1Shaped, SECRET)}`;

    expect(parseSessionToken(token, SECRET)).toBeNull();
  });

  it("鍵が空のまま署名しようとしたら投げる (空鍵で「それらしい署名」を作らない)", () => {
    expect(() => signSessionId(SESSION_ID, "")).toThrow(/CHAT_SESSION_SECRET/);
    expect(() => signSessionId(SESSION_ID, "  \n ")).toThrow(/CHAT_SESSION_SECRET/);
  });
});

/**
 * cx-agent との突き合わせ。
 *
 * 署名は **2 つのリポジトリで別々に実装されている**。web-app はここ (`node:crypto`)、
 * cx-agent は Cloudflare Workers なので `crypto.subtle` + `btoa`
 * (`elxea-cx-agent/src/lib/chat-session.ts` の `signSessionId`)。**1 文字でもずれると
 * 全部弾かれる**が、片方だけを直しても両方のテストは緑のままになる — 契約が
 * どちらのリポジトリにも書かれていないから。
 *
 * そこで向こう側の計算手順をここに **もう一度書いて**、同じ入力から同じ答えが出る
 * ことを固定する。どちらかの実装が動いたらここが赤くなる。
 */
describe("cx-agent と同じ署名になる (2 実装の突き合わせ)", () => {
  /** `elxea-cx-agent/src/lib/chat-session.ts` の signSessionId と同じ手順。 */
  async function signLikeCxAgent(sessionId: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret.trim()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId));
    const bytes = new Uint8Array(sig);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  it("同じ session_id と鍵から、同じ署名が出る", async () => {
    expect(signSessionId(SESSION_ID, SECRET)).toBe(await signLikeCxAgent(SESSION_ID, SECRET));
  });

  it("鍵に前後の空白があっても一致する (両側 trim)", async () => {
    /* 2026-08-30 に共有鍵の末尾改行 1 文字で連携が全滅している。同じ形の事故を
       この鍵でも起こさないよう、両側が trim していることを突き合わせで固定する。 */
    const padded = `  ${SECRET}\n`;
    expect(signSessionId(SESSION_ID, padded)).toBe(await signLikeCxAgent(SESSION_ID, padded));
    expect(signSessionId(SESSION_ID, padded)).toBe(signSessionId(SESSION_ID, SECRET));
  });

  it("複数の値で一致する (1 件のまぐれ当たりで通さない)", async () => {
    for (const id of [SESSION_ID, VICTIM_SESSION_ID]) {
      for (const key of [SECRET, OTHER_SECRET]) {
        expect(signSessionId(id, key), `${id} / ${key}`).toBe(
          await signLikeCxAgent(id, key),
        );
      }
    }
  });
});

describe("cookie に入れる文字列", () => {
  it("署名があれば uuid.sig、無ければ bare UUID", () => {
    const proof = signSessionId(SESSION_ID, SECRET);

    expect(sessionCookieValue(SESSION_ID, proof)).toBe(`${SESSION_ID}.${proof}`);
    expect(sessionCookieValue(SESSION_ID, null)).toBe(SESSION_ID);
  });

  it("bare UUID の判定は v4 の形だけを通す", () => {
    expect(isBareSessionId(SESSION_ID)).toBe(true);
    expect(isBareSessionId(`${SESSION_ID}.sig`)).toBe(false);
    expect(isBareSessionId("not-a-uuid")).toBe(false);
    expect(isBareSessionId(undefined)).toBe(false);
    expect(isBareSessionId("")).toBe(false);
  });
});
