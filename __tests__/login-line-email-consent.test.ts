/**
 * LINE のメールアドレス取得について、ログイン画面で何を約束しているか（M-0 の前提整備）。
 *
 * ## なぜ機械で縛るのか
 *
 * LINE ログインの `email` scope（LINE に登録されたメールアドレスを受け取る）は、
 * LINE の審査を通らないと使えない。審査は**取得の目的が画面上に書かれているか**を見る。
 * 文言が消えたり、用途だけ増えて文言が据え置かれたりすると、
 *
 *   - 審査が通らない（＝ M-0 で作り直したチャネルの email scope が使えないまま）
 *   - あるいは通ったあとに、**約束していない用途で個人情報を使う**状態になる
 *
 * どちらも「壊れているのに緑」になりうる。よって文言の**存在**・**画面に出ていること**・
 * そこに挙げた**用途 3 つ**を固定する。用途を増やすときはこのテストが落ちるので、
 * 文言を直すまで進めない — それが狙いである。
 *
 * ## 何を見ていないか
 *
 * 言い回しは見ない（推敲でテストが落ちるのは無意味）。見るのは「メールアドレスを
 * 取得すると言っているか」「用途を 3 つとも挙げているか」「画面に出しているか」だけ。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import ja from "@/messages/ja.json";
import en from "@/messages/en.json";

const LOGIN_PAGE = readFileSync(
  join(process.cwd(), "app/[locale]/login/page.tsx"),
  "utf8",
);

describe("ログイン画面の LINE メールアドレス取得の説明", () => {
  it("日本語と英語の両方にある（片方だけ足すと英語圏に無言で取得することになる）", () => {
    expect(ja.login.lineEmailConsent?.length ?? 0).toBeGreaterThan(0);
    expect(en.login.lineEmailConsent?.length ?? 0).toBeGreaterThan(0);
  });

  it("何を取得するかを言っている（LINE のメールアドレス）", () => {
    expect(ja.login.lineEmailConsent).toContain("メールアドレス");
    expect(ja.login.lineEmailConsent).toContain("LINE");
    expect(en.login.lineEmailConsent.toLowerCase()).toContain("email address");
    expect(en.login.lineEmailConsent).toContain("LINE");
  });

  /* 用途 3 つ。増やすならここも直す — それが「約束した範囲」の定義になる。 */
  it.each(["注文確認", "お問い合わせ", "連携"])("用途に %s を挙げている", (purpose) => {
    expect(ja.login.lineEmailConsent).toContain(purpose);
  });

  it.each(["order", "support", "link"])("英語版も用途 %s を挙げている", (purpose) => {
    expect(en.login.lineEmailConsent.toLowerCase()).toContain(purpose);
  });
});

describe("文言が実際に画面へ出ている", () => {
  /* 文言があるだけでは意味がない。画面に出て初めて「書いてある」ことになる。
     ページは server component + next-intl なのでここでは描けないため、
     「その key を呼んでいること」を静的に見る。 */
  it("ログイン画面が lineEmailConsent を描画している", () => {
    expect(LOGIN_PAGE).toContain('t("lineEmailConsent")');
    expect(LOGIN_PAGE).toContain('data-testid="line-email-consent"');
  });

  it("LINE ログインボタンのすぐ下に置く（包括の同意文に埋めない）", () => {
    /* 押す直前に読まれる位置であること。カード下部の `terms` は
       「規約に同意したとみなす」という包括の一文で、何を取得するかは書いていない。 */
    const lineButtonAt = LOGIN_PAGE.indexOf('t("lineButton")');
    const consentAt = LOGIN_PAGE.indexOf('t("lineEmailConsent")');
    const dividerAt = LOGIN_PAGE.indexOf('t("or")');

    expect(lineButtonAt).toBeGreaterThan(-1);
    expect(consentAt).toBeGreaterThan(lineButtonAt);
    expect(consentAt).toBeLessThan(dividerAt);
  });
});
