/**
 * 名前の照合用に畳む。全角/半角・大文字小文字・前後の空白の違いで
 * 「同じ名前なのに別物」と判定されないようにする。
 *
 * 実データ (Shopify のコレクション名 / productType) と、コード側やメッセージ側の
 * 名前を突き合わせる場所が複数あるので、畳み方をここ 1 か所に置く。畳み方が
 * 場所ごとに違うと「片方では一致、片方では不一致」という再現しにくい食い違いが
 * 生まれる。
 */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}
