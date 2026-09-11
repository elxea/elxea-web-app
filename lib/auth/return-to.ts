/**
 * ログイン後の戻り先（returnTo）のサニタイズ。
 *
 * なぜ必要か:
 *   Shopify OAuth の callback は従来 `/{locale}/account` へ固定リダイレクトしていた。
 *   LINE のアカウント連携（Account Link）は「連携ページ → 未ログインならログイン → 連携ページに戻って続行」
 *   という往復が要るため、戻り先を渡せるようにする。
 *
 * なぜサニタイズが要るか（open redirect の防止）:
 *   returnTo をそのまま Location に載せると、攻撃者が
 *   `?returnTo=https://evil.example/...` を仕込んだログイン URL を配ることで、
 *   **自社ドメインのログインを経由して外部サイトへ誘導**できてしまう（フィッシングの踏み台）。
 *   よって「自サイト内の相対パス」だけを許可し、それ以外は必ず既定の戻り先に倒す。
 *
 * 許可する形（ホワイトリスト方式・迷ったら拒否）:
 *   - `/` で始まる相対パス（例 `/ja/link`, `/ja/account?x=1`）
 *   - `//` で始まらない（`//evil.example` はブラウザが「プロトコル相対 URL」= 外部として解決する）
 *   - `\` を含まない（一部ブラウザが `/` として解釈し `/\evil.example` が外部化する）
 *   - 制御文字を含まない（改行によるヘッダー分割を防ぐ）
 */

/** returnTo として許容する最大長（クッキー・URL 長の暴走を防ぐ）。 */
export const MAX_RETURN_TO_LENGTH = 512;

/** 制御文字（C0 + DEL）を含むか。ヘッダー分割・不可視文字の混入を防ぐ。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * returnTo を検証し、安全な相対パスだけを返す。
 *
 * @returns 安全な相対パス。危険・空・不正なら null（呼び出し側は既定の戻り先を使う）。
 */
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (raw.length === 0 || raw.length > MAX_RETURN_TO_LENGTH) return null;

  // 制御文字（CR/LF 含む）は即座に拒否する。
  if (hasControlChar(raw)) return null;

  // 自サイト内の絶対パスのみ許可する。
  if (!raw.startsWith("/")) return null;
  // `//host` はプロトコル相対 = 外部サイト。
  if (raw.startsWith("//")) return null;
  // バックスラッシュはブラウザ差異で `/` 扱いになり得るため一律禁止（`/\evil.example` 対策）。
  if (raw.includes("\\")) return null;

  return raw;
}
