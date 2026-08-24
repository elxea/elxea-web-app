/**
 * M-0 — 「ログインで得る ID と、台帳を引く ID が同じ名前空間か」を固定する。
 *
 * ## なぜこのテストが要るのか
 *
 * 2026-07 以降、認証・連携面に 52 commit が積まれたが、本番の連携は一度も成立
 * しなかった。原因はコードではなく **LINE のチャネル構成**で、Web が使う Login
 * チャネルと、台帳に ID を書く Messaging チャネルが**別プロバイダ**にあった。
 * LINE の userId はプロバイダ単位で採番されるので、同じ人でも番号が違う。
 *
 * 最悪なのは**症状が沈黙する**ことだった。照会は 200 で返り、答えも `linked:false`
 * で嘘ではなく、ログにもエラーが出ない。「正しく動いているのに噛み合わない」ので、
 * 監視でもテストでも捕まえようが無かった。
 *
 * よって、ランタイムで確かめられる代理指標 — **4 本の env が同一チャネルを指すか** —
 * を検査する関数を置き、その挙動をここで固定する。プロバイダ ID はランタイムから
 * 引けないので、そこは検査できない（できないことを検査できるふりはしない）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  channelIdFromLiffId,
  checkChannelNamespace,
  isEmailScopeEnabled,
  loginBotPrompt,
  loginScopeParam,
} from "@/lib/line/login-channel";

const KEYS = [
  "AUTH_LINE_ID",
  "LINE_LOGIN_CHANNEL_ID",
  "LINE_LIFF_CHANNEL_ID",
  "NEXT_PUBLIC_LIFF_ID",
  "LINE_LOGIN_EMAIL_SCOPE",
  "LINE_LOGIN_BOT_PROMPT",
] as const;

const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("checkChannelNamespace — 名前空間ガード", () => {
  /** 本番の実構成。4 本すべてが 2011239425 を指す。 */
  const PROD = {
    AUTH_LINE_ID: "2011239425",
    LINE_LOGIN_CHANNEL_ID: "2011239425",
    LINE_LIFF_CHANNEL_ID: "2011239425",
    NEXT_PUBLIC_LIFF_ID: "2011239425-jjC59bI7",
  };

  it("4 本が同一チャネルを指していれば ok", () => {
    const r = checkChannelNamespace(PROD);
    expect(r.ok).toBe(true);
    expect(r.ok && r.channelId).toBe("2011239425");
  });

  it("テストチャネル構成 (Preview) も ok", () => {
    const r = checkChannelNamespace({
      AUTH_LINE_ID: "2011239440",
      LINE_LOGIN_CHANNEL_ID: "2011239440",
      LINE_LIFF_CHANNEL_ID: "2011239440",
      NEXT_PUBLIC_LIFF_ID: "2011239440-0wahaqmd",
    });
    expect(r.ok).toBe(true);
  });

  /**
   * これが本丸。**壊れていた本番の構成をそのまま入れて、mismatch になることを見る。**
   *
   * 旧本番は 4 本とも 2009473839 で「揃って」いた（だから env の一致検査だけでは
   * 捕まらなかった）。捕まえられるのは、切替を**中途半端にやった**形 — 実運用で
   * 最も起きやすい壊し方である。
   */
  it("ログインだけ新チャネル・連携が旧チャネルのままなら mismatch", () => {
    const r = checkChannelNamespace({
      ...PROD,
      LINE_LIFF_CHANNEL_ID: "2009473839",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("mismatch");
    expect(!r.ok && r.reason === "mismatch" && r.detail).toContain("2009473839");
  });

  it("LIFF ID だけ別チャネルのものが残っていれば mismatch", () => {
    const r = checkChannelNamespace({
      ...PROD,
      NEXT_PUBLIC_LIFF_ID: "2009473839-oldSuffix",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("mismatch");
  });

  /* 「無い」を「違う」に丸めない（G3 と同じ立て付け）。連携用の env を持たない
     デプロイで鳴らすと、本物の不一致が埋もれる。 */
  it("比較できるだけの env が無ければ not-configured（mismatch にしない）", () => {
    const r = checkChannelNamespace({ AUTH_LINE_ID: "2011239425" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("not-configured");
  });

  it("env が 1 本も無ければ not-configured", () => {
    const r = checkChannelNamespace({});
    expect(!r.ok && r.reason).toBe("not-configured");
  });

  /* G12（env は必ず trim して読む / 2026-08-22 の本番障害）。`vercel env add < file`
     は末尾改行まで値にする。trim しないと「見た目は同じなのに一致しない」になる。 */
  it("前後の空白・改行があっても一致と判定する", () => {
    const r = checkChannelNamespace({
      AUTH_LINE_ID: " 2011239425\n",
      LINE_LOGIN_CHANNEL_ID: "2011239425",
      LINE_LIFF_CHANNEL_ID: "\r\n2011239425 ",
      NEXT_PUBLIC_LIFF_ID: " 2011239425-jjC59bI7\n",
    });
    expect(r.ok).toBe(true);
  });
});

describe("channelIdFromLiffId", () => {
  it("LIFF ID の前半をチャネル ID として取り出す", () => {
    expect(channelIdFromLiffId("2011239425-jjC59bI7")).toBe("2011239425");
  });

  it("suffix が無い / 数字でない形は null（誤って一致させない）", () => {
    expect(channelIdFromLiffId("2011239425")).toBeNull();
    expect(channelIdFromLiffId("not-a-liff-id")).toBeNull();
    expect(channelIdFromLiffId(undefined)).toBeNull();
    expect(channelIdFromLiffId("  ")).toBeNull();
  });
});

describe("loginScopeParam — email は fail-soft", () => {
  /**
   * 新チャネル 2011239425 の「メールアドレス取得権限」は 2026-08-25 時点で未承認
   * (Console 上 "Unapplied")。未承認のチャネルに `scope=email` を投げると LINE は
   * 認可の段階で拒む = **ログインが丸ごと落ちる**。
   *
   * 連携の成立に email は要らない（正本は line_user_id × shopify_customer_id）ので、
   * 既定は要求しない。
   */
  it("既定では email を要求しない", () => {
    expect(loginScopeParam()).toBe("profile openid");
    expect(isEmailScopeEnabled()).toBe(false);
  });

  it("LINE_LOGIN_EMAIL_SCOPE=enabled のときだけ email を足す", () => {
    process.env.LINE_LOGIN_EMAIL_SCOPE = "enabled";
    expect(loginScopeParam()).toBe("profile openid email");
  });

  it("enabled 以外の値は「無効」に倒す（typo で本番のログインを落とさない）", () => {
    for (const v of ["true", "1", "yes", "ENABLED", ""]) {
      process.env.LINE_LOGIN_EMAIL_SCOPE = v;
      expect(loginScopeParam(), `value=${JSON.stringify(v)}`).toBe("profile openid");
    }
  });

  /* openid が落ちるとログインが成立しなくなる（/api/line-callback は id_token の
     検証をゲートにしている）。email の有無に関わらず必ず載る。 */
  it("openid と profile は常に含まれる", () => {
    for (const v of [undefined, "enabled"]) {
      if (v) process.env.LINE_LOGIN_EMAIL_SCOPE = v;
      else delete process.env.LINE_LOGIN_EMAIL_SCOPE;
      const s = loginScopeParam().split(" ");
      expect(s).toContain("openid");
      expect(s).toContain("profile");
    }
  });
});

describe("loginBotPrompt — 友だち追加の導線", () => {
  /* 2026-04-13 に外し、2026-08-25 に戻した。外した理由（本番 OA が別プロバイダで
     紐付けられない）は新チャネルで解消済み。友だち追加は Account Link と配信が
     届く条件そのものなので、既定で戻す。 */
  it("既定は aggressive", () => {
    expect(loginBotPrompt()).toBe("aggressive");
  });

  it("env で normal / off に切り替えられる（再デプロイ不要）", () => {
    process.env.LINE_LOGIN_BOT_PROMPT = "normal";
    expect(loginBotPrompt()).toBe("normal");
    process.env.LINE_LOGIN_BOT_PROMPT = "off";
    expect(loginBotPrompt()).toBeNull();
  });

  it("未知の値は既定に倒す", () => {
    process.env.LINE_LOGIN_BOT_PROMPT = "sometimes";
    expect(loginBotPrompt()).toBe("aggressive");
  });
});
