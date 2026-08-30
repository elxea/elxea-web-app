/**
 * 「この環境で LINE アプリに渡りうるか」の判定を固定する。
 *
 * 判定の根拠は LINE 公式 FAQ「How does auto login work?」:
 *
 *   > Auto login isn't supported for devices other than iOS and Android devices,
 *   > devices where LINE isn't installed, and in browsers other than the Safari
 *   > browser for iOS.
 *
 * つまり **iPhone の Chrome は恒久的に非対応**である。ここを取り違えると
 * 「アプリが開かないのはコードのせい」という誤診に何度でも戻る。
 */
import { describe, it, expect } from "vitest";

import {
  canHandOffToLineApp,
  classifyAutoLoginEnvironment,
  shouldWarnAboutAutoLogin,
} from "@/lib/line/auto-login-environment";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.35 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0 Mobile/15E148 Safari/604.1",
  lineIosInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.9.0",
  lineAndroidInApp:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.9.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidWebview:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.37.90",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

describe("classifyAutoLoginEnvironment", () => {
  it.each([
    ["iOS Safari", UA.iosSafari, "ios-safari"],
    ["iOS Chrome (CriOS)", UA.iosChrome, "ios-other-browser"],
    ["iOS Firefox (FxiOS)", UA.iosFirefox, "ios-other-browser"],
    ["iOS Edge (EdgiOS)", UA.iosEdge, "ios-other-browser"],
    ["LINE 内ブラウザ (iOS)", UA.lineIosInApp, "line-in-app"],
    ["LINE 内ブラウザ (Android)", UA.lineAndroidInApp, "line-in-app"],
    ["Android Chrome", UA.androidChrome, "android-browser"],
    ["Android webview", UA.androidWebview, "other-in-app-webview"],
    ["Instagram 内ブラウザ", UA.instagramIos, "other-in-app-webview"],
    ["macOS Safari", UA.macSafari, "desktop"],
    ["Windows Chrome", UA.windowsChrome, "desktop"],
  ])("%s → %s", (_name, ua, expected) => {
    expect(classifyAutoLoginEnvironment(ua)).toBe(expected);
  });

  it("UA が無ければ unknown（非対応に丸めない）", () => {
    expect(classifyAutoLoginEnvironment(null)).toBe("unknown");
    expect(classifyAutoLoginEnvironment("")).toBe("unknown");
  });

  it("LINE 内ブラウザは他のどの目印より優先する", () => {
    /* LINE 内ブラウザの UA には Chrome や Safari のトークンも入る。
       先に他の分岐に取られると、対応環境を非対応と誤判定する。 */
    expect(classifyAutoLoginEnvironment(UA.lineAndroidInApp)).toBe("line-in-app");
  });
});

describe("canHandOffToLineApp", () => {
  it("LINE 内ブラウザ / iOS Safari / Android ブラウザは渡りうる", () => {
    expect(canHandOffToLineApp("line-in-app")).toBe(true);
    expect(canHandOffToLineApp("ios-safari")).toBe(true);
    expect(canHandOffToLineApp("android-browser")).toBe(true);
  });

  it("iOS の Safari 以外は渡らない（公式に非対応）", () => {
    expect(canHandOffToLineApp("ios-other-browser")).toBe(false);
  });

  it("unknown は塞がない", () => {
    expect(canHandOffToLineApp("unknown")).toBe(true);
  });
});

describe("shouldWarnAboutAutoLogin", () => {
  it("iPhone の Chrome には事前に伝える", () => {
    expect(shouldWarnAboutAutoLogin(classifyAutoLoginEnvironment(UA.iosChrome))).toBe(
      true,
    );
  });

  it("アプリ内ブラウザにも伝える", () => {
    expect(
      shouldWarnAboutAutoLogin(classifyAutoLoginEnvironment(UA.instagramIos)),
    ).toBe(true);
  });

  it("PC には出さない（QR / メールが出るのは正常で、案内は雑音になる）", () => {
    expect(shouldWarnAboutAutoLogin("desktop")).toBe(false);
  });

  it("対応環境と unknown には出さない", () => {
    expect(shouldWarnAboutAutoLogin("ios-safari")).toBe(false);
    expect(shouldWarnAboutAutoLogin("line-in-app")).toBe(false);
    expect(shouldWarnAboutAutoLogin("android-browser")).toBe(false);
    expect(shouldWarnAboutAutoLogin("unknown")).toBe(false);
  });
});
