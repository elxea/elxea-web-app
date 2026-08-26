/**
 * 共用端末で人が入れ替わったときに、タブに残っているものを断ち切る層を縛る。
 *
 * ## なぜこのファイルが要るのか (QA 指摘 2026-08-25)
 *
 * この「全消し」は `ChatProvider` の `useEffect` に直接書かれていて、**どこにも
 * テストが掛かっていなかった**。4 つの後始末のうち 1 つを消しても、条件を
 * 反転しても、既存のテストは全部緑のまま通る。前の人の会話が次の人に見えるか
 * どうかを決めている層としては、あってはならない状態だった。
 *
 * さらに実装そのものにも死角があった。入れ替わりの判定が「Shopify に
 * ログイン中か」の真偽値 1 つだったので、**LINE だけで入った人はログインでも
 * ログアウトでも値が動かず、入れ替わりが一度も観測されなかった**。
 *
 * ここで縛る契約:
 *   1. 入口の署名が変わったら 4 つとも断ち切る (1 つでも欠けたら落ちる)
 *   2. **LINE だけの往復も入れ替わりとして観測される** (元の死角)
 *   3. 初回観測では断ち切らない (読み込み直しただけの人の会話を巻き戻さない)
 *   4. 変化が無ければ何もしない
 *   5. 作り置きの鍵が、LINE の人と匿名の人で必ず分かれる
 */
import { describe, it, expect, vi } from "vitest";

import { applyAuthTransition } from "@/lib/chat/auth-transition";
import {
  authSignatureFromCookie,
  hasLineAuthFromCookie,
  historyCacheKey,
  isSignedInFromCookie,
} from "@/lib/chat/history-cache";

function effects() {
  return {
    clearCache: vi.fn(),
    rotateSession: vi.fn(),
    forgetIdentity: vi.fn(),
    resetMessages: vi.fn(),
  };
}

describe("入口の署名は cookie を完全一致で読む", () => {
  it("Shopify / LINE / 連携済み / 未ログインを区別する", () => {
    expect(authSignatureFromCookie("shop_auth=1")).toBe("s");
    expect(authSignatureFromCookie("line_auth=1")).toBe("l");
    expect(authSignatureFromCookie("a=b; shop_auth=1; line_auth=1")).toBe("sl");
    expect(authSignatureFromCookie("a=b")).toBe("");
    expect(authSignatureFromCookie("")).toBe("");
    expect(authSignatureFromCookie(undefined)).toBe("");
  });

  it("別名・別値の cookie を認証状態と読み違えない", () => {
    expect(hasLineAuthFromCookie("xline_auth=1")).toBe(false);
    expect(hasLineAuthFromCookie("line_auth=10")).toBe(false);
    expect(hasLineAuthFromCookie("line_auth=0")).toBe(false);
    expect(isSignedInFromCookie("xshop_auth=1")).toBe(false);
    expect(authSignatureFromCookie("xline_auth=1; xshop_auth=1")).toBe("");
  });
});

describe("人が入れ替わったら、タブに残っているものを断ち切る", () => {
  it("4 つとも実行する (1 つでも欠けたら前の人の痕跡が残る)", () => {
    const e = effects();
    expect(applyAuthTransition("s", "", e)).toBe(true);

    expect(e.clearCache).toHaveBeenCalledTimes(1);
    expect(e.rotateSession).toHaveBeenCalledTimes(1);
    expect(e.forgetIdentity).toHaveBeenCalledTimes(1);
    expect(e.resetMessages).toHaveBeenCalledTimes(1);
  });

  /* ここが元の死角。真偽値 1 つ (Shopify にログイン中か) で見ていた実装では、
     下の 3 手すべてで値が `false` のまま動かず、一度も断ち切られなかった。 */
  it("LINE だけの人のログアウト → 別の人のログインも観測される", () => {
    const cookies = ["line_auth=1", "", "line_auth=1"];
    const signatures = cookies.map(authSignatureFromCookie);

    const logout = effects();
    expect(applyAuthTransition(signatures[0], signatures[1], logout)).toBe(true);
    expect(logout.clearCache).toHaveBeenCalledTimes(1);

    const nextPerson = effects();
    expect(applyAuthTransition(signatures[1], signatures[2], nextPerson)).toBe(true);
    expect(nextPerson.rotateSession).toHaveBeenCalledTimes(1);
  });

  it("連携の増減 (メールだけ → メール + LINE) も観測される", () => {
    const e = effects();
    expect(applyAuthTransition("s", "sl", e)).toBe(true);
    expect(e.clearCache).toHaveBeenCalledTimes(1);
  });
});

describe("断ち切ってはいけないとき", () => {
  it("初回観測 (比べる相手が無い) では何もしない", () => {
    const e = effects();
    expect(applyAuthTransition(null, "l", e)).toBe(false);
    expect(e.clearCache).not.toHaveBeenCalled();
    expect(e.rotateSession).not.toHaveBeenCalled();
    expect(e.forgetIdentity).not.toHaveBeenCalled();
    expect(e.resetMessages).not.toHaveBeenCalled();
  });

  it("同じ署名のままページを移っただけでは何もしない", () => {
    for (const signature of ["", "s", "l", "sl"]) {
      const e = effects();
      expect(applyAuthTransition(signature, signature, e)).toBe(false);
      expect(e.clearCache).not.toHaveBeenCalled();
    }
  });
});

describe("作り置きの鍵で、LINE の人と匿名の人が同じ棚を共有しない", () => {
  const base = { sessionId: "s-1", signedIn: false, customerId: null };

  it("LINE の旗が立っているだけで鍵が変わる", () => {
    const anon = historyCacheKey(base);
    const line = historyCacheKey({ ...base, lineAuthed: true });
    expect(line).not.toBe(anon);
  });

  it("LINE ユーザーが違えば鍵も違う", () => {
    const a = historyCacheKey({ ...base, lineAuthed: true, lineUserId: "U-aaa" });
    const b = historyCacheKey({ ...base, lineAuthed: true, lineUserId: "U-bbb" });
    expect(a).not.toBe(b);
  });

  it("LINE ユーザー ID は鍵に生のまま出さない (端末に識別子を残さない)", () => {
    const key = historyCacheKey({ ...base, lineAuthed: true, lineUserId: "U-aaa" });
    expect(key).not.toContain("U-aaa");
  });

  it("Shopify 顧客 ID が解決していればそちらを優先する (従来の鍵と互換)", () => {
    const withLine = historyCacheKey({
      sessionId: "s-1",
      signedIn: true,
      customerId: "gid://shopify/Customer/AAA",
      lineAuthed: true,
      lineUserId: "U-aaa",
    });
    const withoutLine = historyCacheKey({
      sessionId: "s-1",
      signedIn: true,
      customerId: "gid://shopify/Customer/AAA",
    });
    expect(withLine).toBe(withoutLine);
  });
});
