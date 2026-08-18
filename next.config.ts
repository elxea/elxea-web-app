import { execSync } from "node:child_process";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * 配信中のビルドを特定するための値を、**ビルド時に**焼き込む。
 *
 * なぜ実行時の環境変数ではなくビルド時なのか: 本番は Vercel 上でソースから
 * ビルドされる。実行時に読める値だけに頼ると「どのコミットのコードが動いているか」
 * を後から確定できない。ここで文字列として埋め込めば、そのビルドの事実が
 * コードと一緒に配信される (`lib/build-info.ts` 参照)。
 *
 * SHA の解決順序 (先に見つかったものを採用):
 *   1. VERCEL_GIT_COMMIT_SHA — Vercel が git メタデータから注入する
 *   2. GITHUB_SHA           — GitHub Actions のランナー上でビルドする場合
 *   3. `git rev-parse HEAD` — ローカル開発
 *   4. "unknown"            — 上のどれも取れないとき
 *
 * 4 を握りつぶさないこと。検証側 (`scripts/ops/verify-production.mjs`) は
 * "unknown" を成功ではなく **検証不能 (fail-closed)** として扱う。
 */
function resolveBuildSha(): string {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const BUILD_SHA = resolveBuildSha();
const BUILD_TIME = new Date().toISOString();
const BUILD_ENV =
  process.env.VERCEL_ENV ||
  (process.env.NODE_ENV === "production" ? "production" : "development");
const BUILD_DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID || "unknown";

const nextConfig: NextConfig = {
  // 公開してよい「状態」だけ。秘密は絶対に足さないこと (ブラウザにも配信される)。
  env: {
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    NEXT_PUBLIC_BUILD_ENV: BUILD_ENV,
    NEXT_PUBLIC_BUILD_DEPLOYMENT_ID: BUILD_DEPLOYMENT_ID,
  },
  /* Ring 2 (auth-flow e2e) runs the dev server behind a *fake apex*
   * `www.elxea.test` so that the production cookie-Domain branch
   * (`resolveCookieDomain()` → `.elxea.test`) actually executes. Chromium maps
   * `*.elxea.test` to 127.0.0.1 via `--host-resolver-rules`, so no DNS or
   * /etc/hosts entry is involved.
   *
   * Without this allow-list Next 16 rejects the dev-only asset requests that
   * arrive with a non-localhost Origin:
   *   "Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr
   *    from \"www.elxea.test\""
   * which kills HMR and emits console errors — and the Ring 2 check "console
   * errors === 0" is one of the gates, so the suite cannot pass without it.
   *
   * `next start` is NOT an alternative: NODE_ENV=production flips the cookie
   * `secure` flag on, and a Secure cookie is not stored over plain http, so the
   * Domain-scoped deletion under test would never be observable.
   *
   * Scope: dev server only. `allowedDevOrigins` is not consulted by
   * `next build` / `next start`, so production behaviour is unchanged.
   * https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
   */
  allowedDevOrigins: ["www.elxea.test"],
  images: {
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
      {
        protocol: "https",
        hostname: "*.shopify.com",
      },
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
      {
        // M33 Phase C: Asset Hub site-slot images (R2 managed public domain).
        // Mirrors elxea-asset-hub lib/r2.ts R2_PUBLIC_DOMAIN.
        protocol: "https",
        hostname: "pub-90a0485599904fee8228ef56bb51c2e6.r2.dev",
      },
    ],
  },
  // MS10.4: Webflow → Next.js redirects (old site URL structure → new)
  async redirects() {
    return [
      // C10-1: 法人お問い合わせページの廃止 (R2 確定版で 1 ページに統合)。
      // Figma【R2: 確定版】お問い合わせ `8109:46652` は「Common 静的 1 ページ」で、
      // 法人・取材は `お問い合わせの種類` の選択肢 (`8109:46695`) に吸収された。
      // 被リンク・ブックマーク・検索結果を 308 で新しい 1 ページへ寄せる
      // (Server Component の redirect() だと layout が流れた後の client redirect =
      //  HTTP 200 になり、恒久移動のシグナルにならないため routing 層で返す)。
      {
        source: "/:locale(ja|en)/contact/business",
        destination: "/:locale/contact",
        permanent: true,
      },
      {
        source: "/contact/business",
        destination: "/ja/contact",
        permanent: true,
      },
      /* 会員制度 (階層プラン) の廃止に伴う URL 統合。
       *
       * elxea は会員制度を持たない — 会員かどうかは「roji 契約の有無」の二値であり、
       * ランク・ティア・特典階層は作らない (Setaka 確定 2026-08-17 / roji マスター
       * スペックが階層会員を明示禁止)。旧 `/membership` は フリー / スタンダード /
       * プレミアム の 3 階層比較表を出しており、この決定と正面から矛盾する。
       * プラン選択の導線は定期便 LP (`/ja/subscription`) に一本化する。
       *
       * ページ側の `permanentRedirect()` ではなく本ブロックで転送するのは、
       * App Router がシェルを流し始めたあとの redirect を 200 + クライアント遷移に
       * 畳んでしまい 308 にならないため。URL 統合は検索側にも伝える必要があるので、
       * Webflow 移行と同じ `redirects()` (308) に載せる。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。 */
      {
        source: "/ja/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      {
        source: "/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      // Webflow blog posts → journal
      {
        source: "/blog/:slug",
        destination: "/ja/journal/:slug",
        permanent: true,
      },
      {
        source: "/blog",
        destination: "/ja/journal",
        permanent: true,
      },
      // Webflow about → new about
      {
        source: "/about-us",
        destination: "/ja/about",
        permanent: true,
      },
      // Webflow contact
      {
        source: "/contact-us",
        destination: "/ja/contact",
        permanent: true,
      },
      // Webflow shop/store → products
      {
        source: "/shop",
        destination: "/ja/products",
        permanent: true,
      },
      {
        source: "/store",
        destination: "/ja/products",
        permanent: true,
      },
      // Webflow tea menus → tea-menu
      {
        source: "/tea-menus/:slug",
        destination: "/ja/tea-menu/:slug",
        permanent: true,
      },
      {
        source: "/tea-menus",
        destination: "/ja/tea-menu",
        permanent: true,
      },
      // Webflow experience → playlists
      {
        source: "/experience/:slug",
        destination: "/ja/playlists/:slug",
        permanent: true,
      },
      {
        source: "/experience",
        destination: "/ja/playlists",
        permanent: true,
      },
      // Webflow elxea journals
      {
        source: "/elxea-journals/:slug",
        destination: "/ja/elxea-journal/:slug",
        permanent: true,
      },
      {
        source: "/elxea-journals",
        destination: "/ja/elxea-journal",
        permanent: true,
      },
      // Webflow people → people
      {
        source: "/people/:slug",
        destination: "/ja/people/:slug",
        permanent: true,
      },
      // Webflow post categories
      {
        source: "/blog/category/:slug",
        destination: "/ja/journal?category=:slug",
        permanent: true,
      },
      // Webflow privacy/terms
      {
        source: "/privacy-policy",
        destination: "/ja/legal/privacy",
        permanent: true,
      },
      {
        source: "/terms-of-service",
        destination: "/ja/legal/terms",
        permanent: true,
      },
      {
        source: "/terms",
        destination: "/ja/legal/terms",
        permanent: true,
      },
      /* C13-1: メンバーシップ → 定期便LP の恒久統合。
       *
       * メンバーシップは R2 でページごと廃止された (決定 2026-08-08)。根拠は R2 確定版
       * 定期便LP の節 `7973:42297` / `7973:42298`「メンバーシップページ廃止 (決定
       * 2026-08-08) に伴い、プラン選択を LP 内に畳む」と、実体としての節
       * PC `8071:514` / SP `8073:186`「プラン選択 + 購入導線 (最下部のみ /
       * メンバーシップ統合)」。リポジトリ側にも同じ決定が
       * `playwright.config.ts`「会員ランク制度そのものが『無し』に決定済 (2026/08/08)」
       * として記録されている。
       *
       * ページ側の `permanentRedirect()` ではなく本ブロックで転送するのは、
       * App Router がシェルを流し始めたあとの redirect を 200 + クライアント遷移に
       * 畳んでしまい 308 にならないため (実測: /ja/membership が 200 を返した)。
       * URL 統合は検索側にも伝える必要があるので、Webflow 移行と同じ
       * `redirects()` (308) に載せる。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。 */
      {
        source: "/ja/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      {
        source: "/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      /* C17-1: 著者ページ → People 詳細 の恒久統合 (C14-1 の E3 / E4 を閉じる)。
       *
       * 著者ページは Figma の凍結決定
       * 「【廃止: People 詳細へ統合】 ジャーナル:著者」(section `7805:1952`) で
       * ページごと廃止され、`【採用: 作り手の共通テンプレ】 People 詳細`
       * (section `7822:37212`) に吸収された。C14-1 の忠実度対比表でも
       * 「本来は `/journal/author/[slug]` を `/people/[slug]` に寄せて 1 本にするのが筋」
       * として上げていた宿題を、ここで閉じる。
       *
       * データ面で安全に寄せられる根拠: `/people/[slug]` の `PERSON_BY_SLUG_QUERY` は
       * `*[_type == "author" && slug.current == $slug]` を引いており、旧著者ページの
       * `AUTHOR_BY_SLUG_QUERY` と **同じ `author` ドキュメント・同じ slug 空間** を見る。
       * したがって旧 URL で 200 だった slug はすべて新 URL でも 200 になる
       * (取りこぼしが構造上ありえない)。sitemap も既に `/[locale]/people/[slug]` しか
       * 出していない (`app/sitemap.ts`) ので、正規 URL 側の変更は不要。
       *
       * ページ側の `permanentRedirect()` ではなく本ブロックで転送するのは
       * membership (C13-1) と同じ理由 — App Router がシェルを流し始めたあとの
       * redirect は 200 + クライアント遷移に畳まれ 308 にならない。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。 */
      {
        source: "/ja/journal/author/:slug",
        destination: "/ja/people/:slug",
        permanent: true,
      },
      {
        source: "/journal/author/:slug",
        destination: "/ja/people/:slug",
        permanent: true,
      },
      /* 廃止したコレクション詳細の恒久転送 (2026-08-17 / main 一本化で追加)。
       *
       * `/collections/[handle]` は 2026-08-14 (ebc5b95) に廃止した面で、
       * `app/sitemap.ts` からも既に外している。ただし廃止時にリダイレクトを
       * 置いていなかったため、公開済みの URL が 404 になっていた。着地先は
       * 廃止 commit 自身が宣言している商品一覧。
       *
       * 一覧 (`/collections`) は現存するので転送対象にしない。`:handle` は
       * 1 セグメント下なので一覧の URL には一致しない。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。
       *
       * [保留] 農家一覧 `/farmers` (59e9cbe で廃止) の転送はここに入れていない。
       * 後継の一覧ページが存在せず (app/[locale]/people は [slug] だけで一覧を
       * 持たない)、着地先を機械的に決められない。誤った 308 は 404 より害が大きい
       * (恒久転送は強くキャッシュされ、検索側にも誤った統合を伝える) ため、
       * 着地先の判断が付くまで 404 のままにする。農家詳細 `/farmers/:slug` は
       * 現存するので影響しない。 */
      {
        source: "/ja/collections/:handle",
        destination: "/ja/products",
        permanent: true,
      },
      {
        source: "/collections/:handle",
        destination: "/ja/products",
        permanent: true,
      },
      /* 旧 `/roji/*` → `/journal/*` の恒久転送。
       *
       * ジャーナルは旧サイトで `roji` (路地) という名前の面として公開されていて、
       * 記事の Published URL が `elxea.com/roji/<slug>` の形で外に出ている
       * (実例: `/roji/winter-wazuka-tea-fields-morning`)。現行の記事ルートは
       * `app/[locale]/(reading)/journal/[slug]` だけなので、旧 URL を踏むと 404 に
       * なる。slug 空間は同じ (記事側の slug をそのまま使って公開していた) ため、
       * パスの頭だけ差し替えれば旧 URL は漏れなく現行記事へ着地する。
       *
       * ページ側の `permanentRedirect()` ではなく本ブロックで転送するのは
       * membership (C13-1) / 著者ページ (C17-1) と同じ理由 — App Router が
       * シェルを流し始めたあとの redirect は 200 + クライアント遷移に畳まれ、
       * 恒久移動のシグナルにならない。
       *
       * ステータスは他の恒久転送と同じ `permanent: true` (= 308) に揃える。
       * 301 と 308 はどちらも恒久移動で検索側の扱いも同じ (308 はメソッドを
       * 保つぶん厳密) なので、このファイル内で 1 件だけ `statusCode: 301` を
       * 混ぜる理由がない。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。 */
      {
        source: "/ja/roji/:slug",
        destination: "/ja/journal/:slug",
        permanent: true,
      },
      {
        source: "/roji/:slug",
        destination: "/ja/journal/:slug",
        permanent: true,
      },
      {
        source: "/ja/roji",
        destination: "/ja/journal",
        permanent: true,
      },
      {
        source: "/roji",
        destination: "/ja/journal",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      /* LINE 純正 Account Link の入口 (`app/[locale]/link/route.ts`) だけは
       * `Referrer-Policy: no-referrer` にする。
       *
       * なぜ必要か: この入口は `?linkToken=...` を **URL クエリ**で受ける。
       * 上の全体設定 `strict-origin-when-cross-origin` だと、外部 (LINE の
       * 連携ダイアログ = access.line.me) へ 302 したときにリファラとして
       * オリジンが出る。値そのものは載らないが、linkToken を扱う入口だけは
       * リファラを一切出さない `no-referrer` に寄せる — route の doc コメントが
       * 宣言している内容そのもの。
       *
       * なぜ route ではなく next.config か: route handler 側で
       * `res.headers.set("Referrer-Policy", "no-referrer")` しても、実応答は
       * `headers()` 由来の値になる (Next の router は config の header route を
       * `resHeaders` に積んで応答へ載せ、Vercel でも header phase が関数応答の
       * 後に適用される)。宣言と実応答が食い違っていたため、実際に効く層で
       * 指定し直す。
       *
       * 同じキーは **後で一致したエントリが勝つ** (`resHeaders[key] = value` の
       * 上書き) ので、このエントリは全体設定より **後** に置く必要がある。
       * route 側の set は残す (直呼び・将来の配線変更に対する二重防御)。
       *
       * source は locale 付き / 無しの両方を書く。`/en/link` は middleware が
       * 301 で `/ja/link` へ送るが、その 301 応答自体にも付けたいため ja|en 双方。 */
      {
        source: "/:locale(ja|en)/link",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
      {
        source: "/link",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "elxea",
  project: "elxea-web",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
