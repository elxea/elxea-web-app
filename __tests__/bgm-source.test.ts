/**
 * BGM 音源 URL の回帰テスト。
 *
 * 守りたい不変条件は 1 つ: **音源の参照先がリポジトリ内のパスに戻らないこと**。
 *
 * 音源 (35MB) は `.gitignore` で `public/audio/` を除外しているため、git から
 * 取得しただけの作業ツリーには存在しない。`main` への push で走る自動デプロイは
 * checkout した内容だけをビルドするので、`/audio/bgm.mp3` のようなサイト相対
 * パスに戻した瞬間に本番は 404 (無音) に戻る。しかもビルドは成功するので
 * CI では気づけない。だからここで機械的に止める。
 */
import { describe, it, expect } from "vitest";

import { DEFAULT_BGM_URL, resolveBgmUrl } from "@/lib/audio/bgm-source";

describe("BGM 音源 URL", () => {
  it("既定値は外部ストレージの絶対 URL (リポジトリ相対パスに戻していない)", () => {
    expect(DEFAULT_BGM_URL.startsWith("https://")).toBe(true);
    // これが落ちたら「自動デプロイで無音に戻る」変更が入ったということ。
    expect(DEFAULT_BGM_URL.startsWith("/")).toBe(false);
    expect(DEFAULT_BGM_URL).not.toMatch(/^\/audio\//);
  });

  it("既定値は URL として解釈でき、mp3 を指している", () => {
    const url = new URL(DEFAULT_BGM_URL);
    expect(url.protocol).toBe("https:");
    expect(url.pathname.endsWith(".mp3")).toBe(true);
  });

  it("env が未設定なら既定値を使う", () => {
    expect(resolveBgmUrl(undefined)).toBe(DEFAULT_BGM_URL);
  });

  it('空文字・空白だけの env は未設定として扱う (new Audio("") で無音になるのを防ぐ)', () => {
    expect(resolveBgmUrl("")).toBe(DEFAULT_BGM_URL);
    expect(resolveBgmUrl("   ")).toBe(DEFAULT_BGM_URL);
  });

  it("env が設定されていればそちらを優先し、前後の空白は落とす", () => {
    expect(resolveBgmUrl("https://example.test/other.mp3")).toBe(
      "https://example.test/other.mp3"
    );
    expect(resolveBgmUrl("  https://example.test/other.mp3  ")).toBe(
      "https://example.test/other.mp3"
    );
  });
});
