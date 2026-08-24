/**
 * Tests for `LineLinkageEntry`（マイページの LINE 連携節・描画）.
 *
 * ## 直している症状（A 案・2026-08-22 / Setaka 判断）
 *
 * LINE でログインしている人は、連携済みでもマイページに **解除の導線が出なかった**。
 * 解除の API 経路は本番で生きていて、足りないのは入口だけだった。
 *
 * この節が守るべき契約:
 *   1. 連携済みなら、**ログイン経路によらず**状態と解除ボタンを出す。
 *   2. LINE でログイン中（`canLink=false`）は連携ボタンを出さない。
 *      `/api/user/line-link/init` は Shopify セッションを要求するので、押しても
 *      入口で弾かれるボタンを置かない。
 *   3. LINE でログイン中の未連携は節ごと出さない（空の枠を残さない）。
 *   4. ただし状態が読めなかったとき（3 値の null）は黙って消さない。連携済みの人が
 *      「未連携」と読んで解除が要らないと誤解するため。
 *   5. メールでログイン中（`canLink=true`）の振る舞いは従来どおり変えない。
 *
 * 子（`LineUnlinkControl` / `LineLinkageCta`）は client component なので、
 * `renderToStaticMarkup` で扱える印に差し替えて「出たか / 出ていないか」だけを見る。
 * 中身の挙動はそれぞれの担当（route テスト / e2e）が持つ。
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/account/line-unlink-control", () => ({
  LineUnlinkControl: ({ locale }: { locale: string }) => (
    <button data-testid="line-unlink-trigger" data-locale={locale} />
  ),
}));

vi.mock("@/components/account/line-linkage-cta", () => ({
  LineLinkageCta: ({ label }: { label: string }) => (
    <button data-testid="line-linkage-cta">{label}</button>
  ),
}));

import { LineLinkageEntry } from "@/components/account/line-linkage-entry";
import { UNKNOWN_LINE_LINKAGE } from "@/lib/line/linkage-status";

const LINKED = { linked: true, linkedAt: "2026-08-19T21:13:00.000Z" } as const;
const NOT_LINKED = { linked: false, linkedAt: null } as const;

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("LineLinkageEntry / LINE でログイン中（canLink=false）", () => {
  it("連携済み → 解除ボタンを出す（これが出ていなかったのが直した症状）", () => {
    const html = render(
      <LineLinkageEntry locale="ja" status={LINKED} canLink={false} />,
    );

    expect(html).toContain('data-testid="line-unlink-trigger"');
    expect(html).toContain('data-testid="line-linkage-linked"');
    // 連携日は日本時間で出す。
    expect(html).toContain("2026/08/20");
  });

  it("連携済み → 連携ボタンは出さない（押しても入口で弾かれる導線を置かない）", () => {
    const html = render(
      <LineLinkageEntry locale="ja" status={LINKED} canLink={false} />,
    );

    expect(html).not.toContain('data-testid="line-linkage-cta"');
  });

  it("未連携 → ワンタップの入口を出す（連携が一番必要な人に入口を渡す）", () => {
    const html = render(
      <LineLinkageEntry locale="ja" status={NOT_LINKED} canLink={false} />,
    );

    expect(html).toContain('data-testid="line-linkage-one-tap-cta"');
    /* 行き先は意思を封緘する route。ここを /api/auth/login に戻すと、押しても
       連携が起きない旧状態（設計書 §1-2）に逆戻りする。 */
    expect(html).toContain('href="/api/user/line-link/intent?locale=ja"');
    /* LINE の認可へ行く方の CTA は出さない（押しても入口で弾かれる）。 */
    expect(html).not.toContain('data-testid="line-linkage-cta"');
  });

  it("未連携 → 「ログイン」ではなく「連携」と言う（実体が言葉に追いついた）", () => {
    const html = render(
      <LineLinkageEntry locale="ja" status={NOT_LINKED} canLink={false} />,
    );

    expect(html).toContain("メールアドレスと連携する");
  });

  it("状態が読めない → 入口を出したうえで、言い切らない一文を添える", () => {
    const html = render(
      <LineLinkageEntry
        locale="ja"
        status={UNKNOWN_LINE_LINKAGE}
        canLink={false}
      />,
    );

    expect(html).toContain('data-testid="line-linkage-status-unknown"');
    expect(html).toContain('data-testid="line-linkage-one-tap-cta"');
    expect(html).not.toContain('data-testid="line-linkage-cta"');
  });

  it("連携から戻ってきた直後の結果は、未連携でも捨てない", () => {
    const html = render(
      <LineLinkageEntry
        locale="ja"
        status={NOT_LINKED}
        canLink={false}
        result="error"
      />,
    );

    expect(html).toContain('data-testid="line-linkage-notice-error"');
  });

  /**
   * 恒久的な衝突（すでに別の LINE が連携済み）を、一時エラーと同じ顔にしない。
   *
   * かつては 409 も 500 も同じ `error` に潰され、画面は「時間をおいてもう一度
   * お試しください」と案内していた。**永久に成功しない再試行を促していた**わけで、
   * お客さまは同じ操作を繰り返すことになる。J-4 で「1 LINE = 1 顧客」と決めた以上、
   * これは決めたとおりの結果であって障害ではない。
   */
  it("恒久的な衝突は error と別の文言で出す（もう一度お試しください、と言わない）", () => {
    const html = render(
      <LineLinkageEntry
        locale="ja"
        status={NOT_LINKED}
        canLink={false}
        result="conflict"
      />,
    );

    expect(html).toContain('data-testid="line-linkage-notice-conflict"');
    expect(html).not.toContain('data-testid="line-linkage-notice-error"');
    /* 次に取れる行動（先に今の連携を解除する）を伝えていること。
       ここを伏せると、お客さまは同じ操作を繰り返すしかない。 */
    expect(html).toContain("すでに別の LINE アカウントが連携されています");
    expect(html).toContain("解除");
  });

  it("英語ロケールの入口は locale=en を持つ（日本語へ落とさない）", () => {
    const html = render(
      <LineLinkageEntry locale="en" status={NOT_LINKED} canLink={false} />,
    );

    expect(html).toContain('href="/api/user/line-link/intent?locale=en"');
    expect(html).toContain("Link your email address");
  });

  it("英語ロケールでも同じ出し分けになる", () => {
    const html = render(
      <LineLinkageEntry locale="en" status={LINKED} canLink={false} />,
    );

    expect(html).toContain('data-testid="line-unlink-trigger"');
    expect(html).toContain("Linked with LINE");
  });
});

describe("LineLinkageEntry / メールでログイン中（従来の振る舞いを変えない）", () => {
  it("既定は連携フローに入れる扱い（canLink 省略時）", () => {
    const html = render(<LineLinkageEntry locale="ja" status={NOT_LINKED} />);

    expect(html).toContain('data-testid="line-linkage-cta"');
  });

  it("連携済み → 状態 + 解除ボタン（連携ボタンは出さない）", () => {
    const html = render(<LineLinkageEntry locale="ja" status={LINKED} canLink />);

    expect(html).toContain('data-testid="line-unlink-trigger"');
    expect(html).not.toContain('data-testid="line-linkage-cta"');
  });

  it("不明 → 連携ボタン + 「二重にはならない」の一文（従来どおり）", () => {
    const html = render(
      <LineLinkageEntry locale="ja" status={UNKNOWN_LINE_LINKAGE} canLink />,
    );

    expect(html).toContain('data-testid="line-linkage-cta"');
    expect(html).toContain('data-testid="line-linkage-status-unknown"');
    expect(html).toContain("二重にはなりません");
  });
});
