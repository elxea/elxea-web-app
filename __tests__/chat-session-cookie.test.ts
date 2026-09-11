import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHAT_SESSION_COOKIE,
  CHAT_SESSION_COOKIE_MAX_AGE,
  buildChatSessionCookie,
} from "@/lib/chat/session-cookie";

/**
 * 退行検知テスト。
 *
 * 守る不変条件は 1 つ:
 *   **`Secure` は secure context のときだけ付ける。**
 *
 * 非 secure origin (社内 LAN / テスト環境の http://192.168.x.x 等) では、ブラウザが
 * `Secure` 付きクッキーを例外も警告も出さずに破棄する。`document.cookie` への代入は
 * 失敗しても throw しないため、無条件に `Secure` を付けると
 * 「identity linking が非 secure origin で無言で成立しない」= コードの見た目は正しいまま
 * 出荷される故障になる。ここが緑である限り、その形には戻らない。
 */
describe("buildChatSessionCookie", () => {
  const SESSION_ID = "8f14e45f-ea8f-4b1e-9c2b-3a7d5f0e1a22";

  it("secure context では Secure を付ける (本番・localhost の挙動は不変)", () => {
    const cookie = buildChatSessionCookie(SESSION_ID, true);
    expect(cookie).toBe(
      `${CHAT_SESSION_COOKIE}=${SESSION_ID};path=/;max-age=${CHAT_SESSION_COOKIE_MAX_AGE};SameSite=Lax;Secure`,
    );
  });

  it("非 secure context では Secure を付けない (付けるとブラウザに捨てられる)", () => {
    const cookie = buildChatSessionCookie(SESSION_ID, false);
    // 大文字小文字を問わず Secure 属性が出てはいけない。
    expect(cookie.toLowerCase()).not.toContain("secure");
  });

  it("非 secure context でも Secure 以外の属性は落とさない", () => {
    const cookie = buildChatSessionCookie(SESSION_ID, false);
    // 「Secure を消す」を口実に属性ごと削ってしまう退行を防ぐ。
    expect(cookie).toBe(
      `${CHAT_SESSION_COOKIE}=${SESSION_ID};path=/;max-age=${CHAT_SESSION_COOKIE_MAX_AGE};SameSite=Lax`,
    );
  });

  it("secure / 非 secure の差分は Secure 属性ただ 1 つ", () => {
    const secure = buildChatSessionCookie(SESSION_ID, true);
    const insecure = buildChatSessionCookie(SESSION_ID, false);
    expect(secure).toBe(`${insecure};Secure`);
  });
});

/**
 * 呼び出し側の退行検知。
 *
 * 純関数を用意しても、呼び出し側の tsx で `;Secure` をテンプレート文字列に
 * 直書きし直されたら元の欠陥に戻る。そこはユニットテストの型では捕まらないので、
 * 呼び出し側のソースを直接見張る。
 */
describe("LINE ログインボタンの呼び出し側", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/[locale]/login/line-login-button.tsx"),
    "utf-8",
  );

  it("document.cookie へ Secure を直書きしない", () => {
    // 元の欠陥の形: `...;SameSite=Lax;Secure` をテンプレート文字列に直書き。
    expect(source).not.toMatch(/document\.cookie\s*=\s*`[^`]*Secure/);
  });

  it("document.cookie への書き込みは必ず buildChatSessionCookie 経由", () => {
    const assignments = source.match(/document\.cookie\s*=\s*[^;\n]+/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const assignment of assignments) {
      expect(assignment).toContain("buildChatSessionCookie");
    }
  });

  it("secure context の判定に isSecureContext を使う", () => {
    expect(source).toContain("window.isSecureContext");
  });
});
