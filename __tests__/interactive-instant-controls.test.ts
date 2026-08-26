/**
 * 「押した瞬間に効く」を、機構と画面の両側から構造として見張る。
 *
 * ## なぜ振る舞いテストではなく構造テストなのか
 *
 * 守りたいのは速さそのものではなく、**受付を閉じない**という設計上の約束である。
 * 実測値をテストに焼くと機械の速さに左右されて壊れるが、`disabled={isPending}`
 * が戻ってきたかどうかは字面で確実に分かる。#158 が「選択ボタンがナビゲーション系
 * hook を触らない」を構造で見張ったのと同じ考え方。
 *
 * ## 何を直したときのテストか (Setaka 実機指摘 2026-08-26)
 *
 * 数量の +/- は押した瞬間に数字が動いていた (本番実測 16〜30ms) のに「2 秒かかる」
 * と感じられていた。原因は押した直後から本番実測 1,905〜2,062ms のあいだボタンが
 * `disabled` で、250ms 間隔の 2 回目が黙って捨てられていたこと (実測 6 → 7)。
 * カートに追加も同様に 2,561ms 受け付けなかった。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/**
 * 注釈を**行数を保ったまま**消す。
 *
 * **直した経緯そのものが `disabled={isPending}` という字面を含む**ので
 * (「以前はここに置いていた」)、素朴に字面を探すと自分の説明で落ちる。
 * 行頭の印だけで判定しても、`{/* … *\/}` の 2 行目以降には印が無いので漏れる。
 * 塊ごと消したうえで、改行だけ残して行番号をずらさない。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** 進行中を理由に受付を閉じる書き方。 */
const PENDING_LOCK = /disabled(?:=\{|:\s*)[^}\n]*\b(isPending|pending|loading|isSubmitting)\b/;

function pendingLocks(relative: string) {
  return stripComments(read(relative))
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => PENDING_LOCK.test(line));
}

/* -------------------------------------------------------------------------- */
/* 機構そのもの                                                                 */
/* -------------------------------------------------------------------------- */

describe("共通機構が、約束を機構の側で持っている", () => {
  const primitive = read("lib/interaction/use-optimistic-mutation.tsx");

  it("やり直しの利く操作の hook は、楽観更新と連打整理を両方持つ", () => {
    /* 片方だけだと壊れる。楽観更新だけ = 到着順の入れ替わりで数が狂う。
       連打整理だけ = 押した瞬間に何も起きない。 */
    expect(primitive).toMatch(/useOptimistic\(/);
    expect(primitive).toMatch(/createWriteQueue/);
  });

  it("失敗の言い直しは省略できない (型で必須にしてある)", () => {
    /* `onFailure?:` になっていたら「黙って戻す」画面が書けてしまう。 */
    expect(primitive).toMatch(/onFailure: \(input: TInput\) => void;/);
    expect(primitive).not.toMatch(/onFailure\?:/);
  });

  it("金銭・契約向けの hook は、二重送信を機構側で弾く", () => {
    expect(primitive).toMatch(/usePessimisticMutation/);
    expect(primitive).toMatch(/if \(inFlight\.current\) return "failed";/);
  });

  it("金銭・契約向けの hook は、押した瞬間に進行を立てる", () => {
    /* `useTransition` の isPending は遷移が始まるまで立たないことがあり、
       「押した瞬間」を逃しうる。素の state で同期的に立てている。 */
    expect(primitive).toMatch(/const \[isPending, setIsPending\] = useState\(false\)/);
  });
});

describe("迂回はビルドで落ちる", () => {
  const rule = read("eslint-rules/mutation-through-shared-primitive.mjs");

  it("ルールが plugin に登録されている", () => {
    expect(read("eslint-rules/index.mjs")).toMatch(
      /"mutation-through-shared-primitive": mutationThroughSharedPrimitive/,
    );
  });

  it("ルールが error 級で有効になっている (warning ではビルドが通ってしまう)", () => {
    expect(read("eslint.config.mjs")).toMatch(
      /"elxea-tokens\/mutation-through-shared-primitive": "error"/,
    );
  });

  it("逃げ道は allowlist だけで、差分に必ず現れる", () => {
    expect(rule).toMatch(/const ALLOWLIST = new Set\(\[/);
    /* 「縮小方向にのみ更新する」を注記として持たせ、増やす変更をレビューで
       目に入れさせる (人の記憶に頼らない)。 */
    expect(rule).toMatch(/縮小方向にのみ更新する/);
  });

  it("allowlist は棚卸しで実在が確認できたファイルだけを指す", () => {
    /* 実体の無い行が残ると「守れているつもり」の穴になる。 */
    const listed = [...rule.matchAll(/^\s*"([^"]+\.tsx?)",$/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const relative of listed) {
      expect(() => read(relative), `allowlist の ${relative} が実在しない`).not.toThrow();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 画面側                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * やり直しの利く操作。**往復中も押せ続けなければならない**。
 *
 * `disabled` を完全禁止にはしない (在庫切れ・下限に達した `−` など、
 * 「進行中」ではない理由で押せないのは正しい)。禁止するのは
 * **進行中であることを理由に閉じる**形だけ。
 */
const MUST_NOT_LOCK_WHILE_PENDING = [
  "components/cart/cart-content.tsx",
  "components/product/add-to-cart-button.tsx",
  "components/favorites/favorite-toggle-button.tsx",
];

describe("押した瞬間に効く操作は、往復中も受付を閉じない", () => {
  for (const file of MUST_NOT_LOCK_WHILE_PENDING) {
    it(`${file} が進行中を理由に disabled にしない`, () => {
      const offenders = pendingLocks(file);
      expect(
        offenders,
        `進行中を理由に押せなくしている行が残っている:\n` +
          offenders.map((o) => `  ${file}:${o.number}  ${o.line}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("カートは共通機構を通っている", () => {
    const source = read("components/cart/cart-context.tsx");
    expect(source).toMatch(/useOptimisticMutation/);
    expect(source).toMatch(/@\/lib\/interaction\/use-optimistic-mutation/);
  });

  it("カートの数量は、失敗したときに黙らず言い直す", () => {
    /* 追加・削除には前からあった「外れたら言い直す」を、数量にも揃える。 */
    expect(read("components/cart/cart-content.tsx")).toMatch(/updateQuantityFailed/);
  });

  it("「言い直す」文言は日本語・英語の両方にある", () => {
    for (const locale of ["ja", "en"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      expect(
        messages.common.updateQuantityFailed,
        `messages/${locale}.json に updateQuantityFailed が無い`,
      ).toBeTruthy();
    }
  });

  it("カートに追加は加算なので、連打を間引かない", () => {
    /* ここを "latest" にすると「3 回押したのに 1 個しか入らない」になる。 */
    expect(read("components/cart/cart-context.tsx")).toMatch(
      /input\.type === "ADD" \? "all" : "latest"/,
    );
  });
});

describe("取り消しの利かない操作は、逆に閉じたままにする", () => {
  /**
   * 速さのために何でも開けてよいわけではない。契約に二度手を入れると実害が
   * 出る操作は、待たせてでも 1 回に保つ。**この線引き自体**を忘れないよう、
   * 明示的に固定しておく。
   */
  it("定期便の解約確定は二重送信を防ぐために押せなくする", () => {
    const source = read("components/account/subscription-actions.tsx");
    const confirmCancel = source.slice(
      source.indexOf("labels.confirmCancel") - 400,
      source.indexOf("labels.confirmCancel"),
    );
    expect(confirmCancel).toMatch(/disabled=\{isPending\}/);
  });

  it("定期便のパネルを閉じる側は、往復中でも引き返せる", () => {
    const source = read("components/account/subscription-actions.tsx");
    /* `setOpenPanel(null)` だけのボタンは、サーバに触らないので止めない。
       `[^>]` は改行も拾うので `s` フラグは要らない (target が es2017 なので
       付けると型検査で落ちる)。 */
    const closeButtons = [
      ...source.matchAll(/<Button([^>]*?)onClick=\{\(\) => setOpenPanel\(null\)\}/g),
    ];
    expect(closeButtons.length).toBeGreaterThan(0);
    for (const [, attributes] of closeButtons) {
      expect(attributes).not.toMatch(/disabled/);
    }
  });
});
