/**
 * 設定レジストリ (`lib/config`) の回帰テスト — 憲章 R4。
 *
 * ここで押さえているのは「便利になったか」ではなく、**本番で実際に起きた壊れ方が
 * もう起きないか**の 3 点:
 *
 *   1. 貼り付け由来の末尾改行が、値を使う側に届かない (sitemap / LINE 事故)
 *   2. 鍵の導出入力は 1 バイトも変えない (trim してしまうと全セッションが無効になる)
 *   3. 壊れた設定でデプロイが起動しない、かつエラーに値が漏れない
 *
 * 4 番目として「配線」も見る。`NEXT_PUBLIC_*` は literal member expression で
 * しか読めない (動的参照はビルド時インライン化に当たらず、ブラウザで undefined
 * になる) ので、spec.ts の全エントリが本当に literal 読みになっているかを
 * ソースに対して検査する。これが崩れると、テストは緑のままブラウザだけ壊れる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertEnvValid,
  collectEnvIssues,
  env,
  envSnapshot,
  EnvConfigError,
  isProduction,
} from "@/lib/config";
import { ENV_NAMES, ENV_SPEC, SITE_URL_FALLBACK } from "@/lib/config/spec";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("貼り付け由来の空白を落とす (2026-08-22 LINE 連携停止の再発防止)", () => {
  it("Channel Secret の末尾改行を落とす", () => {
    // 本番に入っていたのは「正しい 32 文字 + 見えない改行 1 文字」だった。
    vi.stubEnv("LINE_LOGIN_CHANNEL_SECRET", "0123456789abcdef0123456789abcdef\n");
    expect(env("LINE_LOGIN_CHANNEL_SECRET")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("空白だけの値は「未設定」として undefined を返す", () => {
    // 空文字を返すと、呼び出し側が「設定済みの空の資格情報」を上流に送ってしまう。
    vi.stubEnv("AUTH_LINE_SECRET", "   \n\t ");
    expect(env("AUTH_LINE_SECRET")).toBeUndefined();
  });

  it("LINE の base URL は末尾スラッシュも落とす (`${base}/path` で // にしない)", () => {
    vi.stubEnv("LINE_API_BASE_URL", "  https://api.line.me/  ");
    expect(env("LINE_API_BASE_URL")).toBe("https://api.line.me");
  });
});

describe("鍵の導出入力は 1 バイトも変えない", () => {
  it("SESSION_SECRET は raw のまま返す", () => {
    // trim すると sha256 の入力が変わり、発行済みの Cookie が全部復号できなくなる。
    vi.stubEnv("SESSION_SECRET", "secret-with-newline\n");
    expect(env("SESSION_SECRET")).toBe("secret-with-newline\n");
  });

  it("FIREBASE_PRIVATE_KEY は内部の改行を保つ", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
    vi.stubEnv("FIREBASE_PRIVATE_KEY", pem);
    expect(env("FIREBASE_PRIVATE_KEY")).toBe(pem);
  });

  it("SHOPIFY_WEBHOOK_SECRET (HMAC 鍵) も raw のまま返す", () => {
    vi.stubEnv("SHOPIFY_WEBHOOK_SECRET", " hmac-key ");
    expect(env("SHOPIFY_WEBHOOK_SECRET")).toBe(" hmac-key ");
  });
});

describe("サイト基準 URL (2026-08 sitemap 全 172 件破損の再発防止)", () => {
  it("値の内部に入った改行も落とす", () => {
    // 実際の壊れ方は `https://elxea.com\n` で、これが `${base}/ja` に連結されて
    // `https://elxea.com\n/ja` になっていた。
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://elxea.com\n");
    expect(env("NEXT_PUBLIC_SITE_URL")).toBe("https://elxea.com");
    expect(`${env("NEXT_PUBLIC_SITE_URL")}/ja`).toBe("https://elxea.com/ja");
  });

  it("末尾スラッシュを落とす", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://elxea.com///");
    expect(env("NEXT_PUBLIC_SITE_URL")).toBe("https://elxea.com");
  });

  it("未設定・空文字なら既定値", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(env("NEXT_PUBLIC_SITE_URL")).toBe(SITE_URL_FALLBACK);
  });

  it("http(s) として成立しない値は拒否する", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "elxea.com");
    expect(() => env("NEXT_PUBLIC_SITE_URL")).toThrow(EnvConfigError);
  });

  it("javascript: のような別スキームも拒否する", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "javascript:alert(1)");
    expect(() => env("NEXT_PUBLIC_SITE_URL")).toThrow(EnvConfigError);
  });
});

describe("起動時検証 (fail-fast)", () => {
  it("Vercel 上 (preview 含む) では壊れた設定で例外を投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertEnvValid()).toThrow(EnvConfigError);
  });

  it("本番でも投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    expect(() => assertEnvValid()).toThrow(EnvConfigError);
  });

  it("手元・CI では警告にとどめて起動を止めない", () => {
    // 途中まで設定した .env.local は作業中の正常な状態なので、ここで止めると
    // 「検査を消す」方向の学習が起きる。
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertEnvValid()).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("正常な設定なら何も起きない", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(collectEnvIssues()).toEqual([]);
    expect(() => assertEnvValid()).not.toThrow();
  });
});

describe("エラーに値を載せない", () => {
  it("メッセージに変数名は出るが、受け取った値は出ない", () => {
    // 設定エラーはしばしば資格情報についてのエラーで、received を出すと
    // 設定ミスがそのまま漏洩になる。
    const secretish = "super-secret-value-9f3a";
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", secretish);

    const issues = collectEnvIssues();
    expect(issues.join("\n")).toContain("NEXT_PUBLIC_SITE_URL");
    expect(issues.join("\n")).not.toContain(secretish);

    try {
      env("NEXT_PUBLIC_SITE_URL");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain(secretish);
    }
  });

  it("NODE_ENV の enum 違反でも受け取った値を出さない", () => {
    vi.stubEnv("NODE_ENV", "staging" as "production");
    const issues = collectEnvIssues();
    expect(issues.join("\n")).toContain("NODE_ENV");
    expect(issues.join("\n")).not.toContain("staging");
  });
});

describe("envSnapshot (DI seam の既定値)", () => {
  it("レジストリの全変数を含む", () => {
    const snap = envSnapshot();
    for (const name of ENV_NAMES) expect(snap).toHaveProperty(name);
  });

  it("正規化後の値を返す", () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", " 127.0.0.1:8080 \n");
    expect(envSnapshot().FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
  });
});

describe("配線 assert — 読み方そのものを固定する", () => {
  const specSource = readFileSync(join(process.cwd(), "lib/config/spec.ts"), "utf8");

  it.each(ENV_NAMES)(
    "%s は literal member expression で読まれている",
    (name) => {
      // 動的 `process.env[name]` は Next のビルド時インライン化に当たらないため、
      // NEXT_PUBLIC_* はブラウザで undefined になる。テストは Node で走るので
      // 実行時には気づけない — だからソースを直接見る。
      expect(specSource).toContain(`process.env.${name}`);
    },
  );

  it("spec.ts 以外に process.env を読む設定コードが増えていない", () => {
    // lib/config/index.ts は spec.ts の read クロージャ越しにしか触らない。
    // 散文中の `process.env` (「外部は process.env に触れない」等の説明) は
    // 対象外なので、コメントを落としてから見る。
    const indexSource = readFileSync(join(process.cwd(), "lib/config/index.ts"), "utf8");
    const code = indexSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("process.env");
  });

  it("チャネル名前空間ガードが見る 4 本が全部レジストリにある", () => {
    // これを落とすと「ガードが静かに縮む」。checkChannelNamespace() の既定値が
    // process.env から envSpanshot() に変わった結果、レジストリに無い名前は
    // **比較対象から消えるだけ**で、ガードは 3/4 本を見て OK と言い続ける。
    // 実際に LINE_LOGIN_CHANNEL_ID がこの穴に落ちかけた (2026-08-27)。
    // 検知したい障害は「書く側と読む側が別チャネル」で、これは顧客の連携が
    // 引けなくなるまで表に出ない類のもの。
    for (const name of [
      "AUTH_LINE_ID",
      "LINE_LOGIN_CHANNEL_ID",
      "LINE_LIFF_CHANNEL_ID",
      "NEXT_PUBLIC_LIFF_ID",
    ]) {
      expect(ENV_NAMES).toContain(name);
      expect(envSnapshot()).toHaveProperty(name);
    }
  });

  it("全エントリが read と schema を持つ", () => {
    for (const name of ENV_NAMES) {
      const entry = ENV_SPEC[name];
      expect(typeof entry.read).toBe("function");
      expect(entry.schema).toBeDefined();
    }
  });
});
