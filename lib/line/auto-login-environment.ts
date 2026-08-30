/**
 * 「この環境で LINE の自動ログインは成立しうるか」を User-Agent から見分ける。
 *
 * ## なぜこれが要るのか
 *
 * LINE の公式 FAQ はこう書いている:
 *
 *   > Auto login isn't supported for devices other than iOS and Android devices,
 *   > devices where LINE isn't installed, and **in browsers other than the Safari
 *   > browser for iOS**.
 *
 * つまり iPhone の Chrome / Firefox / Edge、および Instagram・X・Facebook などの
 * アプリ内ブラウザでは、LINE の**自動ログイン**は成立しない。LINE はそういう環境の
 * 人を黙って access.line.me のメール/パスワード/QR 画面へ送る。それが「パスワードを
 * 覚えていない」「スマホなので QR を読めない」で詰まる画面である。
 *
 * ## この分類の使い道は 2 つある
 *
 * 1. **導線そのものを変える**（`shouldUseLineAppHandoff`）。自動ログインが成立しない
 *    環境では、ボタンのタップ先を `access.line.me` の認可 URL ではなく、LINE アプリに
 *    結び付いた `access-auto.line.me/oauth2/v2.1/login` にする。自動ログインは
 *    「LINE の画面が内部でその URL へ遷移する」形なので Safari 以外では切れるが、
 *    **利用者自身のタップ**なら OS はアプリを開く候補として扱う。根拠と association
 *    ファイルの実測は `lib/line/endpoints.ts`。
 *
 * 2. **押す前に伝える**（`shouldWarnAboutAutoLogin`）。1 が効かなかったとき
 *    （アプリ未インストール / アプリ内 WebView が外部アプリを開かない設定 など）の
 *    行き止まりを、押した後ではなく押す前に説明する。
 *
 * ## この判定は「押させない」ためのものではない
 *
 * 判定は UA 文字列に頼るので確実ではない（UA は詐称でき、将来変わる）。よって
 * **ボタンは常に押せるままにする**。1 の分岐も、外したときの行き先は LINE の
 * 通常のログイン画面（＝今日と同じ画面）であって、袋小路が増えることはない。
 * `unknown` を「非対応」に丸めないのも同じ理由。
 *
 * 一次情報:
 *   https://developers.line.biz/en/faq/  （"How does auto login work?"）
 *   https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/
 */

/**
 * 自動ログインの成立可能性で環境を分類した結果。
 *
 * 「対応」は *成立しうる* という意味であって、*必ず成立する* ではない。
 * プライベートブラウズや OS 側の事情で落ちることは公式に明記されている。
 */
export type AutoLoginEnvironment =
  /** LINE のアプリ内ブラウザ。公式に対応。そもそも LINE の中なので最も確実。 */
  | "line-in-app"
  /** iOS の Safari。iOS で公式に対応している唯一の外部ブラウザ。 */
  | "ios-safari"
  /** iOS の Safari 以外（Chrome / Firefox / Edge 等）。**公式に非対応**。 */
  | "ios-other-browser"
  /** Android の外部ブラウザ（Chrome 等）。公式に対応。 */
  | "android-browser"
  /** LINE 以外のアプリ内ブラウザ（Instagram / Facebook / X 等）。発火しないことがある。 */
  | "other-in-app-webview"
  /** PC。「Auto login doesn't work on LINE for PC」。 */
  | "desktop"
  /** 判定できない。**非対応とみなさない**。 */
  | "unknown";

/**
 * LINE 以外のアプリ内ブラウザ（webview）の目印。
 *
 * これらは OS の既定ブラウザではないため、Universal Links / App Links が
 * 発火しないことがある（公式: "Universal Links or App Links may not work in
 * external browsers or in **some in-app browsers**"）。
 */
const IN_APP_WEBVIEW_TOKENS = [
  "instagram",
  "fbav", // Facebook
  "fban", // Facebook
  "fb_iab", // Facebook in-app browser
  "twitter",
  "tiktok",
  "micromessenger", // WeChat
  "kakaotalk",
  "snapchat",
  "pinterest",
  "linkedinapp",
];

/**
 * iOS で Safari **ではない**ブラウザの目印。
 *
 * iOS のブラウザはすべて WebKit なので UA に `Safari` を含むが、各社は自社の
 * トークンを足している。これがあれば Safari ではない。
 */
const IOS_NON_SAFARI_TOKENS = [
  "crios", // Chrome for iOS
  "fxios", // Firefox for iOS
  "edgios", // Edge for iOS
  "opt/", // Opera Touch
  "yjapp", // Yahoo! JAPAN
  "duckduckgo",
  "brave",
];

/** User-Agent から自動ログインの成立可能性を分類する。 */
export function classifyAutoLoginEnvironment(
  userAgent: string | null | undefined,
): AutoLoginEnvironment {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();

  /* LINE のアプリ内ブラウザが最優先。UA に ` Line/` が入る。
     これは「対応」の側なので、他のどの判定よりも先に確定させる。 */
  if (/\bline\//.test(ua)) return "line-in-app";

  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  /* LINE 以外のアプリ内ブラウザ。iOS / Android のどちらでも起こる。 */
  if (IN_APP_WEBVIEW_TOKENS.some((t) => ua.includes(t))) {
    return "other-in-app-webview";
  }

  if (isIOS) {
    if (IOS_NON_SAFARI_TOKENS.some((t) => ua.includes(t))) {
      return "ios-other-browser";
    }
    /* iOS で `Safari` を名乗り、他社トークンが無いなら Safari とみなす。
       WKWebView の素の UA には `Safari` が入らないので、ここで弾かれる。 */
    return ua.includes("safari") ? "ios-safari" : "other-in-app-webview";
  }

  if (isAndroid) {
    /* Android の webview は UA に `; wv)` を含む。 */
    if (ua.includes("; wv)")) return "other-in-app-webview";
    return "android-browser";
  }

  /* iOS でも Android でもない = PC / その他。公式に非対応。 */
  if (/windows|macintosh|cros|linux/.test(ua)) return "desktop";

  return "unknown";
}

/**
 * その環境で LINE アプリへの受け渡しが**起こりうる**か。
 *
 * `unknown` は `true` を返す（分からないことを理由に案内を出すと、正常な人にまで
 * 余計な但し書きを見せることになる）。
 */
export function canHandOffToLineApp(env: AutoLoginEnvironment): boolean {
  return (
    env === "line-in-app" ||
    env === "ios-safari" ||
    env === "android-browser" ||
    env === "unknown"
  );
}

/**
 * 「スマホなのに LINE アプリが開かない」と**事前に分かる**環境か。
 *
 * 案内を出す条件はこれ。PC はそもそもアプリを開く話をしていないので含めない
 * （PC で QR / メールが出るのは正常であり、案内は雑音になる）。
 *
 * `shouldUseLineAppHandoff` と**同じ集合**を返す。同じ環境に対して
 * 「導線を変える」と「変えても外れうると伝える」を同時に行うためで、片方だけを
 * 動かすと『アプリが開く前提の画面なのに案内が出ない』等のちぐはぐが起きる。
 * 意図的に一方だけ変えるときは、両方の呼び出し側を読んでからにすること。
 */
export function shouldWarnAboutAutoLogin(env: AutoLoginEnvironment): boolean {
  return env === "ios-other-browser" || env === "other-in-app-webview";
}

/**
 * ボタンのタップ先を **LINE アプリに結び付いた URL** に切り替えるべき環境か。
 *
 * ## 切り替える側だけを選ぶ理由
 *
 * `line-in-app` / `ios-safari` / `android-browser` は自動ログインが公式に成立する
 * 環境で、今日すでにアプリが開いている。**動いているものは触らない** —
 * 受け渡し URL は LINE の内部仕様に寄りかかっており（`returnUri` + `loginChannelId`
 * という組み合わせは公式のパラメータ表には無い）、公式に文書化された
 * `access.line.me/oauth2/v2.1/authorize` の方が寿命が長い。壊れている環境にだけ
 * 当てれば、外れたときに失うものは今日と同じ画面だけで済む。
 *
 * `unknown` を含めないのも同じ判断である（分からないものを内部仕様側へ倒さない）。
 * `desktop` は QR / メールで入るのが正しい姿なので当然含めない。
 */
export function shouldUseLineAppHandoff(env: AutoLoginEnvironment): boolean {
  return env === "ios-other-browser" || env === "other-in-app-webview";
}
