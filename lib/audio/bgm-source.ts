/**
 * サイト常駐 BGM の音源 URL の唯一の定義箇所。
 *
 * ## なぜリポジトリ内のファイルを指さないのか
 *
 * 音源は 35MB あり、`.gitignore` で `public/audio/` を除外している。つまり
 * **git から取得しただけの作業ツリーには音源ファイルが存在しない**。
 * 一方 `main` への push で走る自動デプロイ (`.github/workflows/deploy.yml`) は
 * `actions/checkout` した内容だけをビルドするので、`/audio/bgm.mp3` という
 * サイト相対パスを参照している限り **自動デプロイでは必ず 404 になる**。
 * 実際に「手元から手動でデプロイした時だけ音が鳴る」状態になっていた
 * (Issue ID-7660)。
 *
 * そこで音源を Vercel Blob (公開ストア `elxea-web-assets`) に置き、ここでは
 * その絶対 URL を参照する。Blob の URL は CDN 配信・Range 要求対応
 * (シーク可能)・`cache-control: max-age=31536000` で、リポジトリの状態に
 * 一切依存しない。**クリーンなチェックアウトからデプロイしても音は鳴る。**
 *
 * ## 既定値をハードコードしている理由
 *
 * 環境変数だけに頼ると、変数を設定し忘れた環境で再び無音 (404) に戻り、
 * しかもビルドは成功するので誰も気づけない。既定値をコードに持たせて
 * 「何も設定しなくても鳴る」状態を保証し、env は差し替え用の上書きに留める。
 * この URL は公開コンテンツの所在であり秘密情報ではない (トークン不要で誰でも
 * 取得できる) ため、リポジトリに書いて問題ない。
 *
 * ## 音源を差し替えるとき
 *
 * 1. `vercel blob put <file> --pathname audio/bgm.mp3 --allow-overwrite true`
 *    (`--content-type audio/mpeg` / `--cache-control-max-age 31536000`)
 * 2. 同じパス名なら URL は変わらないのでコード変更は不要。別パスに置いた
 *    場合はこの定数を更新する。
 * 3. Sanity 側にも音源 URL を持つドキュメントがある (記事の `audioUrl` /
 *    プレイリストの `tracks[].audioUrl`)。そちらは Sanity のデータなので
 *    このファイルの管轄外。
 */

import { env } from "@/lib/config";

/**
 * Vercel Blob 上の BGM 音源 (公開・CDN 配信)。
 * `NEXT_PUBLIC_BGM_URL` を設定するとそちらが優先される (検証用の差し替え)。
 */
export const DEFAULT_BGM_URL =
  "https://iib5b7jkxstwom3v.public.blob.vercel-storage.com/audio/bgm.mp3";

/**
 * 実際に `new Audio()` へ渡す BGM の URL。
 *
 * 空文字・空白だけの env は「未設定」として扱う (Vercel の env をうっかり
 * 空で作った場合に `new Audio("")` で無音になるのを防ぐ)。
 */
export function resolveBgmUrl(
  override: string | undefined = env("NEXT_PUBLIC_BGM_URL")
): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_BGM_URL;
}

export const BGM_URL = resolveBgmUrl();
