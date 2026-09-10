/**
 * `resolveLinkChannelSecret` — 連携の token 交換に載せる Channel Secret の選び方。
 *
 * ## この test が守っている本番事故（2026-08-25 15:55 JST）
 *
 * LINE のチャネルを `2011239425` へ移す作業で、**ログインが読む `AUTH_LINE_SECRET`
 * だけが新しい値に更新され**、連携が読む `LINE_LIFF_CHANNEL_SECRET` は旧チャネルの
 * 値のまま取り残された。チャネル **ID** は 3 本とも新しい値に揃っていたため
 * `checkChannelNamespace` は沈黙し、`/api/health/line` も緑のままだった。
 *
 * 結果、`client_id` は新・`client_secret` は旧 という組が LINE に送られ、
 * `POST /oauth2/v2.1/token` は毎回 `400 invalid_client` を返した。ログインは通るのに
 * 連携だけが必ず落ちる、という切り分けの難しい壊れ方をした。
 *
 * 同一チャネルの Channel Secret は定義上 1 つしか無い。よって「どの env 名に入って
 * いるか」ではなく「現に通っている秘密はどれか」で選ぶ。それがログインの
 * `AUTH_LINE_SECRET` である。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLinkChannelSecret } from "@/lib/line/link-flow";

/** 実在の値は使わない。長さだけ本物（32 文字）に似せた識別可能なダミー。 */
const LOGIN_SECRET = "a".repeat(32);
const STALE_LIFF_SECRET = "b".repeat(32);
const LEGACY_LOGIN_SECRET = "c".repeat(32);

const CHANNEL = "2011239425";
const OTHER_CHANNEL = "2009473839";

/** 4 本まとめて置き直す。stubEnv は各 test 後に自動で巻き戻る。 */
function setEnv(env: {
  linkId?: string;
  loginId?: string;
  loginSecret?: string;
  liffSecret?: string;
  legacyLoginSecret?: string;
}) {
  vi.stubEnv("LINE_LIFF_CHANNEL_ID", env.linkId ?? "");
  vi.stubEnv("AUTH_LINE_ID", env.loginId ?? "");
  vi.stubEnv("AUTH_LINE_SECRET", env.loginSecret ?? "");
  vi.stubEnv("LINE_LIFF_CHANNEL_SECRET", env.liffSecret ?? "");
  vi.stubEnv("LINE_LOGIN_CHANNEL_SECRET", env.legacyLoginSecret ?? "");
}

describe("resolveLinkChannelSecret", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("2026-08-25 の再現: 連携専用の秘密が旧チャネルのまま取り残されても、ログインの秘密を使って連携は通る", () => {
    // ID は揃っている（= 名前空間ガードは鳴らない）が、秘密だけが割れている状態。
    setEnv({
      linkId: CHANNEL,
      loginId: CHANNEL,
      loginSecret: LOGIN_SECRET,
      liffSecret: STALE_LIFF_SECRET,
    });

    // 事故前の実装はここで STALE_LIFF_SECRET を返し、LINE に invalid_client を出させていた。
    expect(resolveLinkChannelSecret()).toBe(LOGIN_SECRET);
  });

  it("同一チャネルなら、連携専用の秘密が未設定でもログインの秘密で成立する", () => {
    setEnv({ linkId: CHANNEL, loginId: CHANNEL, loginSecret: LOGIN_SECRET });

    expect(resolveLinkChannelSecret()).toBe(LOGIN_SECRET);
  });

  it("チャネルが実際に分かれているときは、ログインの秘密を流用しない", () => {
    // 別チャネルの秘密を送れば invalid_client を自作することになる。専用 env に戻る。
    setEnv({
      linkId: OTHER_CHANNEL,
      loginId: CHANNEL,
      loginSecret: LOGIN_SECRET,
      liffSecret: STALE_LIFF_SECRET,
    });

    expect(resolveLinkChannelSecret()).toBe(STALE_LIFF_SECRET);
  });

  it("ログイン側の ID / 秘密が欠けているときは流用せず、従来の解決順に戻る", () => {
    setEnv({ linkId: CHANNEL, liffSecret: STALE_LIFF_SECRET });
    expect(resolveLinkChannelSecret()).toBe(STALE_LIFF_SECRET);

    // 秘密だけ欠けている場合も同じ（ID 一致だけでは流用の条件を満たさない）。
    setEnv({ linkId: CHANNEL, loginId: CHANNEL, liffSecret: STALE_LIFF_SECRET });
    expect(resolveLinkChannelSecret()).toBe(STALE_LIFF_SECRET);
  });

  it("従来のフォールバック（LIFF 未設定なら LINE_LOGIN_CHANNEL_SECRET）は壊れていない", () => {
    setEnv({ linkId: OTHER_CHANNEL, legacyLoginSecret: LEGACY_LOGIN_SECRET });

    expect(resolveLinkChannelSecret()).toBe(LEGACY_LOGIN_SECRET);
  });

  it("何も設定されていなければ undefined（呼び出し側が fail-closed する）", () => {
    setEnv({});

    expect(resolveLinkChannelSecret()).toBeUndefined();
  });

  it("流用する値も trim される（末尾改行が client_secret に載らない）", () => {
    // 2026-08-22 の事故が AUTH_LINE_SECRET 側で再発しても連携が巻き込まれないこと。
    setEnv({
      linkId: CHANNEL,
      loginId: `${CHANNEL}\n`,
      loginSecret: `${LOGIN_SECRET}\n`,
    });

    expect(resolveLinkChannelSecret()).toBe(LOGIN_SECRET);
  });
});
