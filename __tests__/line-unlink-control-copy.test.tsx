/**
 * 連携解除の確認ダイアログの文面を、**挙動の正本と一致していること**として縛る。
 *
 * ## なぜ文言をテストするのか
 *
 * 普通、文言はテストで固めない（言い回しを直すたびに赤くなるだけの重しになる）。
 * ここが例外なのは、この 4 段が「言い回し」ではなく **解除したらデータがどこへ行くかの
 * 説明＝お客さまへの約束**だからで、しかもその約束は
 * `__tests__/link-unlink-data-lifecycle.test.ts` が固定している実挙動と一致していないと
 * ただの嘘になる。挙動側は既にテストで固定されているのに説明側が野放しだと、
 * 「実装は正しいが画面が違うことを言っている」状態がテスト緑のまま成立してしまう。
 *
 * ## 何を縛り、何を縛らないか
 *
 * 縛るのは**意味の 3 点が文面に出ていること**だけで、一字一句ではない。言い回しの調整は
 * 自由に通り、3 点のどれかが落ちたときだけ赤くなる。
 *
 *   1. 保管先を言う   … lifecycle C1（データはメールでログインするアカウント側に残る）
 *   2. LINE 側は空    … lifecycle C2（解除すると LINE からは見えなくなる）
 *   3. 再連携で戻る   … lifecycle D1（同じメールアドレスに再連携すれば元どおり）
 *
 * 1 が要るのは、このダイアログが**メールでログイン中の人にも LINE でログイン中の人にも
 * 同じものが出る**ため。「残ります」とだけ書くと、LINE 経路の人は「LINE から今までどおり
 * 見える」と読む — C2 の逆で、そのまま嘘になる。場所を書いて初めて両方に正しく読める。
 *
 * 2 と 3 は対で必要。2 だけなら「消えた」と受け取られ、3 だけなら「LINE からも見え続ける」
 * と受け取られる。どちらの誤解も、解除を押す・押さないの判断を誤らせる。
 *
 * ## なぜダイアログ本体ではなく `LineUnlinkDialogCopy` を描画するのか
 *
 * Radix の `AlertDialogContent` は開いていないと DOM に出ないので、ダイアログごと描くには
 * ブラウザで開く操作が要る（そちらは `e2e/line-linkage-flow.spec.ts` が担当し、
 * 実際に開いて `line-unlink-keeps` が見えることまで確かめている）。ここは node の unit で
 * 文面そのものを見るのが目的なので、説明文だけを持つ部品を直接描く。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LineUnlinkDialogCopy } from "@/components/account/line-unlink-control";

/** 指定 testid の段落の中身を取り出す（属性順に依存しない素朴な抜き出し）。 */
function paragraph(html: string, testId: string): string {
  const match = new RegExp(`<p[^>]*data-testid="${testId}"[^>]*>(.*?)</p>`, "s").exec(html);
  if (!match) throw new Error(`段落 ${testId} が描画されていない`);
  return match[1];
}

function render(locale: string): string {
  return renderToStaticMarkup(<LineUnlinkDialogCopy locale={locale} />);
}

describe("解除の確認ダイアログ / 4 段そろって出る", () => {
  it.each(["ja", "en"])("%s: 説明の 4 段がすべて描画される", (locale) => {
    const html = render(locale);
    for (const id of [
      "line-unlink-keeps",
      "line-unlink-friendship",
      "line-unlink-afterwards",
      "line-unlink-delivery",
    ]) {
      expect(paragraph(html, id).length, `${id} が空`).toBeGreaterThan(0);
    }
  });

  it("知らないロケールは日本語に倒す（英語のまま出さない）", () => {
    expect(paragraph(render("fr"), "line-unlink-keeps")).toBe(
      paragraph(render("ja"), "line-unlink-keeps"),
    );
  });
});

describe("解除の確認ダイアログ / 挙動と一致した約束をしている（日本語）", () => {
  const html = render("ja");

  it("1. データの保管先を言う（lifecycle C1: メール側のアカウントに残る）", () => {
    const keeps = paragraph(html, "line-unlink-keeps");

    /* 「残ります」だけでは足りない。**どこに**残るのかまで言えているか。 */
    expect(keeps).toContain("メールアドレスでログイン");
    expect(keeps).toMatch(/保管|残り/);
    /* 何が残るのかも具体で言う（抽象名詞だけだと自分の持ち物だと分からない）。 */
    expect(keeps).toContain("お気に入り");
  });

  it("2. 解除すると LINE からは見えなくなると言う（lifecycle C2）", () => {
    const afterwards = paragraph(html, "line-unlink-afterwards");
    expect(afterwards).toContain("LINEからは見えなくなります");
  });

  it("3. 再連携すれば戻ると言う（lifecycle D1）", () => {
    const afterwards = paragraph(html, "line-unlink-afterwards");
    expect(afterwards).toContain("もう一度連携");
    expect(afterwards).toMatch(/ご覧いただけます|戻り/);
  });

  it("「見えなくなる」と「戻る」は必ず同じ段に置く（片方だけ読ませない）", () => {
    /* 別々の段に散ると、読み飛ばした側の誤解（消えた / LINE からも見える）が出る。
       同居を強制することで、片方を消す編集がこのテストで止まる。 */
    const afterwards = paragraph(html, "line-unlink-afterwards");
    expect(afterwards).toContain("LINEからは見えなくなります");
    expect(afterwards).toContain("もう一度連携");
  });

  it("消えると誤解させない（解除 ≠ データ削除）", () => {
    const keeps = paragraph(html, "line-unlink-keeps");
    const afterwards = paragraph(html, "line-unlink-afterwards");
    expect(keeps).toContain("消えるものはありません");
    expect(afterwards).toContain("なくなったわけではありません");
  });

  it("友だち登録の話と混ぜない（解除するのは結び付きだけ）", () => {
    expect(paragraph(html, "line-unlink-friendship")).toContain("友だち登録はそのまま");
  });
});

describe("解除の確認ダイアログ / 英語も同じ 3 点を言っている", () => {
  const html = render("en");

  it("1. 保管先（sign in by email 側のアカウント）", () => {
    expect(paragraph(html, "line-unlink-keeps")).toContain("sign in to by email");
  });

  it("2. LINE からは見えなくなる", () => {
    expect(paragraph(html, "line-unlink-afterwards")).toContain(
      "no longer visible from LINE",
    );
  });

  it("3. 再連携で戻る", () => {
    const afterwards = paragraph(html, "line-unlink-afterwards");
    expect(afterwards).toContain("Link again");
    expect(afterwards).toContain("come back");
  });
});
