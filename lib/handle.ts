/**
 * 動的ルートの `handle` セグメント正規化。
 *
 * `params.handle` にはレンダリング経路によって **encode 済みのまま**渡ることが
 * ある。実測 (2026-08-08 Preview) では generateMetadata 側は decode 済みで
 * リソースを引けるのに、Page 側は encode 済みのまま Shopify に送られて
 * null → notFound() となり、タイトルだけ正しく本文が 404 になっていた。
 *
 * decode 済みの文字列に再度 decodeURIComponent をかけても `%` を含まない限り
 * 変化しないため冪等。不正な `%` 混じり (decode 不能) は元の値を使う。
 *
 * products/[handle] と collections/[handle] の双方から参照する共通実装。
 */
export function decodeHandle(handle: string): string {
  try {
    return decodeURIComponent(handle);
  } catch {
    return handle;
  }
}
