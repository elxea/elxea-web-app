/**
 * `server-only` パッケージのテスト用シム。
 *
 * 本物の `server-only` (`node_modules/server-only/index.js`) は「Client
 * Component から import された」という前提で常に throw する — Next のバンドラ
 * だけが `react-server` condition で無害な `empty.js` に差し替える。Vitest の
 * unit プロジェクトはその条件解決を持たないため、`import "server-only"` を
 * 持つモジュール (`lib/profile/source.ts` / `lib/profile/live/*` /
 * `lib/profile/synthetic/*` など) を直接 import すると常に落ちる。
 *
 * ここでは Vitest 側だけ `vitest.config.ts` の `resolve.alias` でこのファイルに
 * 差し替える (本番ビルドの解決には一切影響しない — Next 側は素の `server-only`
 * を見続けるので、クライアントバンドルへの混入防止という本来の役割は保たれる)。
 */
export {};
