/**
 * maplibre-gl の Web Worker を `public/maplibre/` へ複製する。
 *
 * ## なぜ複製が要るのか
 *
 * maplibre-gl 6 は GeoJSON の解析・タイル化を **Worker で** 行う。Worker の
 * スクリプトは同梱の別ファイル (`maplibre-gl-worker.mjs`) で、本体は
 * `import.meta.url` からその URL を組み立てる:
 *
 * ```js
 * function defaultWorkerUrl() {
 *   const moduleUrl = import.meta.url;
 *   if (!/^https?:/.test(moduleUrl)) return "";   // ← Turbopack ではここで抜ける
 *   ...
 * }
 * ```
 *
 * Turbopack は `import.meta.url` を自前の内部値 (`__TURBOPACK__import$2e$meta__.url`)
 * に書き換えるので `^https?:` に一致せず、**Worker URL が空文字になる**。
 * `new Worker("")` はドキュメント自身を Worker として読もうとして失敗し、
 * GeoJSON は 1 バイトも解析されない。地図は「枠と DOM のピンだけが出て、
 * 陸も海岸線も県境も出ない」状態で止まる (canvas は全ピクセル透明のまま)。
 *
 * 対処は MapLibre 公式の Turbopack / Next.js 手順どおり、Worker を `public/` から
 * 配って `setWorkerUrl` で指す (https://github.com/maplibre/maplibre-gl-js の
 * docs/index.md「Turbopack」タブ)。
 *
 * ## なぜ 2 ファイル複製するのか
 *
 * Worker は `./maplibre-gl-shared.mjs` を **相対パスで** import する。同じ
 * ディレクトリに並べないと Worker は最初の import で落ちるので、道連れで複製する。
 *
 * ## なぜ git に入れずビルド時に作るのか
 *
 * node_modules から複製するので、常にインストール済みのバージョンと一致する。
 * コミットすると maplibre-gl の更新時に静かに古いままになる (二重管理)。
 * よって `public/maplibre/` は .gitignore に入れ、`dev` / `build` の先頭で作る。
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `public/` 配下の複製先。URL は `/` + これ + ファイル名 になる。 */
export const MAPLIBRE_PUBLIC_DIR = "maplibre";

/** 複製するファイル。worker 本体と、それが相対 import する相方。 */
export const MAPLIBRE_WORKER_FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

/** `setWorkerUrl` に渡す URL。`lib/viz/map-style.ts` の写しと突き合わせて検査する。 */
export const MAPLIBRE_WORKER_URL = `/${MAPLIBRE_PUBLIC_DIR}/${MAPLIBRE_WORKER_FILES[0]}`;

export function copyMaplibreWorker(projectRoot = process.cwd()) {
  const require = createRequire(import.meta.url);
  const dist = path.join(
    path.dirname(require.resolve("maplibre-gl/package.json")),
    "dist",
  );
  const dest = path.join(projectRoot, "public", MAPLIBRE_PUBLIC_DIR);
  mkdirSync(dest, { recursive: true });
  for (const file of MAPLIBRE_WORKER_FILES) {
    copyFileSync(path.join(dist, file), path.join(dest, file));
  }
  return dest;
}

// 直接実行されたときだけ複製する (テストから定数だけ読めるようにするため)。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dest = copyMaplibreWorker();
  console.log(`[copy-maplibre-worker] ${MAPLIBRE_WORKER_FILES.join(", ")} -> ${dest}`);
}
