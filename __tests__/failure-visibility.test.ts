import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { Linter } from "eslint";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import elxeaTokens from "../eslint-rules/index.mjs";

/**
 * 設計憲章 Wave 3「失敗の可視化」の回帰テスト。
 *
 * ここが守るのは **1 つの主張**だけ:
 *   「外の世界と話す場所で失敗が起きたら、必ず誰かに届く」
 *
 * 主張が成り立たなくなる**変異**を 3 通り用意し、そのどれでも赤くなることを
 * 確かめる。装置があること (ファイルが存在すること) ではなく、装置が**効いて
 * いること**を確かめるのが目的である。
 *
 *   変異 1: lint を無効化する (error → warn / off、対象区画を外す)
 *   変異 2: 例外表を広げる (grandfather を増やす)
 *   変異 3: 記録の通り道を迂回する (console だけ / warn に落とす / Sentry 直呼び)
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/* -------------------------------------------------------------------------- */
/* 変異 1: lint を無効化すると落ちる                                            */
/* -------------------------------------------------------------------------- */

describe("握り潰しはビルドで落ちる", () => {
  const config = read("eslint.config.mjs");

  it("ルールが plugin に登録されている", () => {
    expect(read("eslint-rules/index.mjs")).toMatch(
      /"no-silent-catch-at-boundary":\s*noSilentCatchAtBoundary/,
    );
  });

  it("ルールが error 級で有効になっている (warning ではビルドが通ってしまう)", () => {
    expect(config).toMatch(/"elxea-tokens\/no-silent-catch-at-boundary":\s*"error"/);
  });

  it("外の世界と話す 4 区画すべてが網に入っている", () => {
    /* Wave 1 は網が 3 区画しか無く、外にあった 10 件を見落としていた。
       同じ取りこぼしを繰り返さないため、区画の列挙をテストで固定する。 */
    for (const area of [
      '"lib/shopify/**/*.ts"',
      '"lib/firebase/**/*.ts"',
      '"lib/line/**/*.ts"',
      '"app/api/**/*.ts"',
    ]) {
      expect(config).toContain(area);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ルールが実際に何を落とすか (fixture を linter に通す)                         */
/* -------------------------------------------------------------------------- */

describe("ルールが判定を間違えない", () => {
  const linter = new Linter();

  /** 対象区画にある架空のファイルとして 1 本 lint する。 */
  function lint(code: string, filename = "lib/shopify/__rule-fixture__.ts") {
    const messages = linter.verify(
      code,
      [
        {
          /* `files` を書かないと `.ts` に一致する設定が無いと言われ、ルールが
             一度も走らないまま「指摘 0 件」になる。テストが空振りしていることに
             気づけない形なので、ここで必ず一致させる。 */
          files: ["**/*.ts"],
          plugins: { "elxea-tokens": elxeaTokens as never },
          rules: { "elxea-tokens/no-silent-catch-at-boundary": "error" },
          languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        },
      ],
      path.join(ROOT, filename),
    );

    /* 設定不一致・構文エラーは ruleId が付かない。混ざったまま数えると
       上と同じ空振りを見逃すので、ここで気づけるようにする。 */
    const unrelated = messages.filter((m) => m.ruleId === null);
    if (unrelated.length > 0) {
      throw new Error(`lint fixture did not run cleanly: ${JSON.stringify(unrelated)}`);
    }
    return messages;
  }

  it("console だけの catch は落ちる (ログは誰にも届かない)", () => {
    const messages = lint(`
      export function load() {
        try { fetchThing(); } catch (e) { console.error("failed", e); return null; }
      }
    `);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("silent");
  });

  it("空の catch は落ちる", () => {
    expect(lint(`try { a(); } catch {}`)).toHaveLength(1);
  });

  it("投げ直す catch は通る", () => {
    expect(lint(`try { a(); } catch (e) { throw e; }`)).toHaveLength(0);
  });

  it("Sentry に載せる catch は通る", () => {
    expect(
      lint(`function f() { try { a(); } catch (e) { Sentry.captureException(e); return null; } }`),
    ).toHaveLength(0);
  });

  it("共通 logger の error に載せる catch は通る", () => {
    expect(
      lint(`function f() { try { a(); } catch (e) { logger.error("shopify.x.failed", e); return null; } }`),
    ).toHaveLength(0);
  });

  it("Wave 0 の報告ヘルパ (report*) に載せる catch は通る", () => {
    expect(
      lint(`function f() { try { a(); } catch (e) { reportLoadFailure("customer", e); return null; } }`),
    ).toHaveLength(0);
  });

  /* --- 変異 3 の一部: 記録の通り道を迂回する --- */

  it("logger.warn に落として静かにする逃げ道は塞がれている", () => {
    /* `warn` は Sentry に載らない。載らないものを「残した」と数えると、
       ルールを通したまま無音に戻せてしまう。 */
    const messages = lint(`try { a(); } catch (e) { logger.warn("shopify.x", { e }); }`);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("silent");
  });

  it("入れ子の関数の中の throw は「投げ直した」に数えない", () => {
    /* コールバックの中で投げても呼び出し元には伝わらない。 */
    expect(
      lint(`try { a(); } catch (e) { queue.push(() => { throw e; }); }`),
    ).toHaveLength(1);
  });

  /* --- その場の逃げ道は、理由を書いたときだけ開く --- */

  it("expected-failure は理由を書けば通る", () => {
    expect(
      lint(`
        function safeOrigin(url) {
          try { return new URL(url).origin; }
          catch {
            // expected-failure: 利用者が持ち込む文字列なので、壊れているのは想定内。
            return null;
          }
        }
      `),
    ).toHaveLength(0);
  });

  it("expected-failure に理由が無ければ通らない", () => {
    expect(
      lint(`function f() { try { a(); } catch { /* expected-failure: */ return null; } }`),
    ).toHaveLength(1);
  });

  /* --- 例外表の外にある新しい違反は 1 件目から落ちる --- */

  it("例外表に無いファイルは 1 件目から落ちる", () => {
    expect(
      lint(
        `try { a(); } catch (e) { console.error(e); }`,
        "app/api/__rule-fixture__/route.ts",
      ),
    ).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 変異 2: 例外表を広げると落ちる                                               */
/* -------------------------------------------------------------------------- */

describe("例外表は縮小方向にしか動かない", () => {
  const source = read("eslint-rules/no-silent-catch-at-boundary.mjs");

  /** ルール本体から例外表の中身を読み出す (実行時の値ではなく原文を見る)。 */
  function grandfatheredEntries(): { file: string; count: number }[] {
    const table = source.slice(
      source.indexOf("const GRANDFATHERED"),
      source.indexOf("/** 調査できる形に残したとみなす呼び出し。 */"),
    );
    return [...table.matchAll(/\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/g)].map((m) => ({
      file: m[1],
      count: Number(m[2]),
    }));
  }

  it("例外表は空である (着手時点の 75 件は全件移行した)", () => {
    /* ここが**変異 2 の検知点**。1 行でも grandfather を足すと落ちる。
       憲章 R8 の「全件移行 + 再流入止めで 1 セット」を数字で固定している。 */
    expect(grandfatheredEntries()).toEqual([]);
  });

  it("例外表に載せる場合でも、実在するファイルしか指せない", () => {
    /* 表が空なら何もしない。将来 1 件でも足したときに、消えたファイルを指した
       まま残る (= 死んだ免罪符) ことを防ぐ。 */
    for (const entry of grandfatheredEntries()) {
      expect(existsSync(path.join(ROOT, entry.file)), entry.file).toBe(true);
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  it("表より実数が少なくなったら落ちる仕掛けがある (数字が据え置かれない)", () => {
    expect(source).toContain("staleAllowlist");
  });
});

/* -------------------------------------------------------------------------- */
/* 変異 3: 記録の通り道を迂回すると落ちる                                        */
/* -------------------------------------------------------------------------- */

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("記録の通り道が約束を持っている", () => {
  beforeEach(() => {
    captureException.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("error は console と Sentry の両方に載る (どちらに載せるかを選ばせない)", async () => {
    const { logger } = await import("@/lib/log");
    logger.error("payment.subscription.charge-failed", new Error("boom"), { id: "sub_1" });

    expect(console.error).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);

    const [, options] = captureException.mock.calls[0];
    expect(options.level).toBe("error");
    expect(options.tags).toMatchObject({
      event: "payment.subscription.charge-failed",
      area: "payment",
    });
  });

  it("warn / info は Sentry に載らない (本当に鳴ってほしい error を埋もれさせない)", async () => {
    const { logger } = await import("@/lib/log");
    logger.warn("payment.subscription.retry", { id: "sub_1" });
    logger.info("payment.subscription.scheduled", { id: "sub_1" });

    expect(captureException).not.toHaveBeenCalled();
  });

  it("Error でないものを投げられても stack を持った形で載る", async () => {
    const { logger } = await import("@/lib/log");
    logger.error("api.contact.send-failed", "just a string");

    const [error] = captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("api.contact.send-failed");
  });

  it("画面からの書き込みが失敗したら、言い直しとは別に必ず記録が残る", async () => {
    /* 着手時点でここは `console.error` 1 行で、components/** の
       captureException は 0 件だった = 顧客の操作が落ちても誰も知らなかった。 */
    const { createWriteQueue } = await import("@/lib/interaction/write-queue");
    const queue = createWriteQueue<number>({ operation: "cart.write" });

    const outcome = await queue.enqueue("line-1", 2, async () => {
      throw new Error("network down");
    });

    expect(outcome).toBe("failed");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.event).toBe("ui.write.send-failed");
  });
});

/* -------------------------------------------------------------------------- */
/* 個人情報は記録に載せない                                                      */
/* -------------------------------------------------------------------------- */

describe("記録に個人情報を載せない", () => {
  it("鍵の名前で落とす (呼び出し側の注意力に頼らない)", async () => {
    const { redact } = await import("@/lib/log/redact");
    const out = redact({
      customerId: "gid://shopify/Customer/1",
      email: "someone@example.com",
      firstName: "太郎",
      accessToken: "abc",
      operationName: "getCustomer",
    }) as Record<string, unknown>;

    expect(out.customerId).toBe("gid://shopify/Customer/1");
    expect(out.email).toBe("[redacted]");
    expect(out.firstName).toBe("[redacted]");
    expect(out.accessToken).toBe("[redacted]");
    /* `name` を部分一致で落とすと調査に要る情報まで消えるので、残ること自体を固定する。 */
    expect(out.operationName).toBe("getCustomer");
  });

  it("値の形でも落とす (上流のメッセージに混ざってくる)", async () => {
    const { redactString } = await import("@/lib/log/redact");

    expect(redactString("customer someone@example.com not found")).not.toContain("@example.com");
    expect(redactString("id_token=eyJhbGci.eyJzdWIi.SflKxwRJ")).not.toContain("eyJhbGci");
    expect(redactString("tel 090-1234-5678")).not.toContain("090-1234-5678");
  });

  it("落とした跡は残す (項目ごと消すと調査で嘘になる)", async () => {
    const { redact } = await import("@/lib/log/redact");
    const out = redact({ email: "a@b.co" }) as Record<string, unknown>;
    expect(Object.keys(out)).toContain("email");
    expect(out.email).toBe("[redacted]");
  });

  it("例外のメッセージも通す", async () => {
    const { redactError } = await import("@/lib/log/redact");
    const safe = redactError(new Error("failed for someone@example.com"));
    expect(safe.message).not.toContain("someone@example.com");
  });
});

/* -------------------------------------------------------------------------- */
/* 画面の受け皿も同じ通り道を通る                                                */
/* -------------------------------------------------------------------------- */

describe("エラー画面の受け皿が、どこで落ちたかを残す", () => {
  const boundaries = [
    ["app/global-error.tsx", "ui.boundary.global"],
    ["app/[locale]/error.tsx", "ui.boundary.locale"],
    ["app/[locale]/account/error.tsx", "ui.boundary.account"],
  ] as const;

  for (const [file, event] of boundaries) {
    it(`${file} は lib/log を通して ${event} として残す`, () => {
      const source = read(file);
      expect(source).toContain(`logger.error("${event}"`);
      /* Sentry 直呼びに戻すと、区画のタグも個人情報の除去も外れる。 */
      expect(source).not.toContain("@sentry/nextjs");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 記録そのものが動作を変えない                                                  */
/* -------------------------------------------------------------------------- */

describe("記録が失敗しても、呼び出し元の動きを変えない", () => {
  beforeEach(() => {
    captureException.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("記録に渡した値がその場で例外を投げても、logger は投げ返さない", async () => {
    /* この logger は catch の中から呼ばれるのが常態なので、ここで投げると
       「可視化を足しただけ」の変更が動作を変えてしまう。 */
    const { logger } = await import("@/lib/log");
    const hostile = {
      get boom(): string {
        throw new Error("getter exploded");
      },
    };

    expect(() => logger.error("api.x.failed", new Error("real"), hostile)).not.toThrow();
  });

  it("Sentry 側が投げても、logger は投げ返さない", async () => {
    const { logger } = await import("@/lib/log");
    captureException.mockImplementationOnce(() => {
      throw new Error("transport down");
    });

    expect(() => logger.error("api.x.failed", new Error("real"))).not.toThrow();
  });

  it("循環参照を渡しても止まらない", async () => {
    const { redact } = await import("@/lib/log/redact");
    const loop: Record<string, unknown> = { id: "1" };
    loop.self = loop;

    expect(() => redact(loop)).not.toThrow();
  });
});
