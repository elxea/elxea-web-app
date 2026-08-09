import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
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
