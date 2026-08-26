/**
 * cookie 名の正本が「本当に 1 つ」であることを固定する — 憲章 R5 / R8 (Wave 4)。
 *
 * ここで確かめるのは 3 つ:
 *
 *  (i)   レジストリと `COOKIE_NAME` が**全件対応**していること。片方にしか無い
 *        名前があると、その cookie だけ生文字列で書くしかなくなり、lint の網から
 *        構造的に外れる。着手時点が実際にその状態だった (26 本中 13 本だけが
 *        `COOKIE_NAME` に居た)。
 *  (ii)  lint ルールが**レジストリから名前を取れている**こと。ルールは `.mjs` で
 *        TypeScript を import できないのでソースを読んで抽出しており、抽出が
 *        壊れると「何も報告しないルール」= 常に緑になる。緑が「違反なし」ではなく
 *        「見ていない」を意味する状態を、ここで検出する。
 *  (iii) ルールに**歯がある**こと。生文字列を書いたコードで実際に落ち、
 *        レジストリ経由のコードでは落ちないことを、Linter を起動して確かめる。
 *
 * (iii) が無いと (i)(ii) は「設定が正しいこと」しか言っておらず、ルールが実際に
 * 発火するかは誰も見ていないことになる。
 */
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import rule, {
  REGISTRY_SOURCE,
} from "../eslint-rules/cookie-name-through-registry.mjs";
import { COOKIE_NAME, COOKIE_REGISTRY } from "@/lib/auth/cookie-names";

const registryNames: string[] = COOKIE_REGISTRY.map((spec) => spec.name).sort();
/* `as const` の literal union ではなく `string[]` として扱う。ここでやりたいのは
   「両者の集合が一致するか」の実行時比較であり、型で一致を仮定してしまうと
   ズレたときにコンパイルが通らないだけで、テストが何も言わなくなる。 */
const handleValues: string[] = Object.values(COOKIE_NAME).slice().sort();

describe("レジストリと COOKIE_NAME の対応", () => {
  it("レジストリの全 cookie が COOKIE_NAME に名前を持つ", () => {
    const missing = registryNames.filter((name) => !handleValues.includes(name));
    expect(
      missing,
      `COOKIE_NAME に名前が無い cookie: ${missing.join(", ")}。` +
        "名前が無いと呼び出し側は生文字列で書くしかなく、lint の網から構造的に外れる。",
    ).toEqual([]);
  });

  it("COOKIE_NAME に、レジストリに無い名前が混ざっていない", () => {
    const unknown = handleValues.filter((name) => !registryNames.includes(name));
    expect(
      unknown,
      `レジストリに登録の無い名前: ${unknown.join(", ")}。` +
        "scope / secure が決まらない cookie は発行も削除も規則が定まらない。",
    ).toEqual([]);
  });

  it("同じ名前が 2 つの handle に割り当てられていない", () => {
    expect(new Set(handleValues).size).toBe(handleValues.length);
  });
});

describe("lint ルールが名前をレジストリから取れている", () => {
  it("ルールが読むファイルが cookie-names.ts である", () => {
    expect(REGISTRY_SOURCE.replace(/\\/g, "/")).toMatch(/lib\/auth\/cookie-names\.ts$/);
  });

  it("ルールの抽出結果が COOKIE_REGISTRY と一致する", () => {
    /* ルールは import 時に抽出し、0 件なら throw する。ここまで到達している
       時点で 1 件以上あることは保証されているので、中身の一致を見る。
       抽出方法 (正規表現) が変わっても、ここが両者を繋ぎ止める。 */
    const linter = new Linter();
    const extracted = new Set<string>();
    for (const name of [...registryNames, "definitely_not_a_cookie"]) {
      const messages = linter.verify(
        `const x = ${JSON.stringify(name)};`,
        [
          {
            files: ["**/*.ts"],
            plugins: { local: { rules: { target: rule } } },
            rules: { "local/target": "error" },
          },
        ],
        "probe.ts",
      );
      if (messages.length > 0) extracted.add(name);
    }
    expect([...extracted].sort()).toEqual(registryNames);
    expect(extracted.has("definitely_not_a_cookie")).toBe(false);
  });
});

/** ルールを 1 本だけ載せた Linter で 1 ファイル分だけ検査する。 */
function lint(code: string) {
  return new Linter().verify(
    code,
    [
      {
        files: ["**/*.ts"],
        plugins: { local: { rules: { "cookie-name-through-registry": rule } } },
        rules: { "local/cookie-name-through-registry": "error" },
      },
    ],
    "app/api/probe/route.ts",
  );
}

describe("変異: ルールに歯があるか", () => {
  it("生の cookie 名を書いたら落ちる", () => {
    const messages = lint(`const v = request.cookies.get("line_session")?.value;`);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("line_session");
    expect(messages[0].message).toContain("COOKIE_NAME");
  });

  it("置換なしテンプレートリテラルで書いても落ちる", () => {
    const messages = lint("const v = cookies.get(`shop_rt`);");
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("shop_rt");
  });

  it("複数の生文字列はその数だけ落ちる", () => {
    const messages = lint(
      `const a = get("shop_at");\nconst b = get("shop_rt");\nconst c = get("line_uid");`,
    );
    expect(messages).toHaveLength(3);
  });

  it("レジストリ経由なら落ちない", () => {
    const messages = lint(
      `import { COOKIE_NAME } from "@/lib/auth/cookie-names";\n` +
        `const v = request.cookies.get(COOKIE_NAME.lineSession)?.value;`,
    );
    expect(messages).toEqual([]);
  });

  it("cookie 名でない文字列は落ちない (誤検出しない)", () => {
    const messages = lint(
      `const a = "shop";\nconst b = "session";\nconst c = "line_sessions";`,
    );
    expect(messages).toEqual([]);
  });
});
