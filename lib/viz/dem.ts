/**
 * 標高タイル (DEM) の読み込みとデコード。ブラウザ専用 (canvas を使う)。
 *
 * ## タイルの出どころ
 *
 * Mapterhorn の terrarium DEM (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`)。
 * **API キー不要・CORS 開放**。MapLibre 側の `raster-dem` source と同じ実体を
 * 共有するので、地図の陰影と等高線が同じ標高から起きる (ずれない)。
 *
 * ## 順序を守らないと標高が壊れる
 *
 * terrarium は R が上位バイトなので、`drawImage` の縮小補間で RGB を混ぜると
 * 標高が壊れる (G の 255→0 巻き戻り地点で ±128m の斑点が出る)。よって
 * **ネイティブ解像度で `getImageData` → 数値でデコード → 数値で再標本化** の
 * 順序を厳守する。
 *
 * `fetch` した blob から `createImageBitmap` するので canvas は汚染されない
 * (`crossOrigin` 属性経由の `<img>` だと `getImageData` が落ちる)。
 *
 * 出典: viz 査定 `verdicts.md` の `21-terroir-styles/dem.js`。
 */

/** タイル 1 枚の辺 (px)。Mapterhorn の tilejson が返す値。 */
export const DEM_TILE_SIZE = 512;
/** タイル URL。拡張子は `.png` ではなく `.webp` (tilejson に書いてある)。 */
export const DEM_TILE_TEMPLATE = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
/**
 * MapLibre の `raster-dem` source に渡す tilejson。
 *
 * `tiles` を直書きせず tilejson を読ませるのは、`encoding: "terrarium"` /
 * `tileSize: 512` / 帰属表示を**提供側の宣言から取る**ため。手で書き写すと
 * 提供側が変えたときに静かにずれる (標高が壊れてもエラーは出ない)。
 */
export const DEM_TILEJSON_URL = "https://tiles.mapterhorn.com/tilejson.json";
/**
 * 画面に必ず出す帰属表示。
 *
 * 以前は `DEM (C) Mapterhorn` だった。DEM は社内語、`(C)` は記号が出せなかった
 * 時代の書き方で、地図の下にこの 1 行が本文と同じ体裁で置かれていたため、
 * 読み手には**意味の分からない生テキストが記事の中に紛れている**ようにしか
 * 見えなかった (監査 #20 / 2026-08-25 の /ja/tea-menu 実測)。
 *
 * 帰属表示は法的義務なので消せない。消せないなら**帰属表示として読める形**に
 * する — 平易な語 (標高データ)・正しい記号 (`©`)・出典へのリンク。体裁側
 * (右寄せ・キャプション級) は `terroir-overview-map.tsx` が受け持つ。
 */
export const DEM_ATTRIBUTION = "標高データ © Mapterhorn";

/** 帰属表示のリンク先 (提供元)。 */
export const DEM_ATTRIBUTION_URL = "https://mapterhorn.com";

export interface DemView {
  west: number;
  east: number;
  south: number;
  north: number;
}

export const lngToTileX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;

export const latToTileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export const tileYToLat = (ty: number, z: number) => {
  const n = Math.PI * (1 - (2 * ty) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

export const tileXToLng = (tx: number, z: number) => (tx / 2 ** z) * 360 - 180;

export interface ScreenProjection {
  project: (lng: number, lat: number) => { x: number; y: number };
  unproject: (x: number, y: number) => { lng: number; lat: number };
}

/**
 * 中心・ズーム・枠の大きさから画面座標への投影を作る。
 *
 * ## なぜ地図インスタンスの `project` / `unproject` を使わないのか
 *
 * 地図は `interactive: false` で中心もズームも動かないので、投影は **地図の
 * 状態に依存しない純粋な計算**でしかない。それでも地図から引くと、板の組み立てが
 * 地図の初期化成功に縛られる。MapLibre は WebGL2 が無い環境で構築時に例外を
 * 投げる (`GPUInitializationError`) ため、**地図が立たないだけで等高線・気候・
 * 土・茶園の板まで 1 枚も出なくなる**。
 *
 * 投影を自前で持てば板は地図と独立に組める。地図が立たなければ段彩と陰影の
 * 基層が無いだけで、残りのレンズはそのまま出る。
 *
 * MapLibre の平面投影 (pitch / bearing = 0) と同じ式:
 * 世界の幅は `512 * 2^zoom` px、中心が枠の中央に来る。
 */
export function createScreenProjection({
  center,
  zoom,
  width,
  height,
}: {
  center: { lng: number; lat: number };
  zoom: number;
  width: number;
  height: number;
}): ScreenProjection {
  const worldTile = 512;
  const centerX = lngToTileX(center.lng, zoom) * worldTile;
  const centerY = latToTileY(center.lat, zoom) * worldTile;
  const offsetX = width / 2 - centerX;
  const offsetY = height / 2 - centerY;

  return {
    project: (lng, lat) => ({
      x: lngToTileX(lng, zoom) * worldTile + offsetX,
      y: latToTileY(lat, zoom) * worldTile + offsetY,
    }),
    unproject: (x, y) => ({
      lng: tileXToLng((x - offsetX) / worldTile, zoom),
      lat: tileYToLat((y - offsetY) / worldTile, zoom),
    }),
  };
}

function bilinear(
  source: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number
): number {
  const x = Math.min(width - 1.001, Math.max(0, fx));
  const y = Math.min(height - 1.001, Math.max(0, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const a = source[y0 * width + x0];
  const b = source[y0 * width + x0 + 1];
  const c = source[(y0 + 1) * width + x0];
  const d = source[(y0 + 1) * width + x0 + 1];
  return (
    a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
  );
}

export interface DemGrid {
  grid: Float64Array;
  width: number;
  height: number;
  min: number;
  max: number;
}

export interface Dem {
  z: number;
  view: DemView;
  /** 読み込んだタイル枚数。 */
  tiles: number;
  /** 404 だったタイル (全面が海のタイルは存在しない)。 */
  missed: number;
  /** 任意の解像度に標本化する (縮小は面積平均 / 拡大は bilinear)。 */
  resample: (width: number, height: number) => DemGrid;
  /** 切り出し窓の中の相対位置 (0..1) から標高を引く。 */
  elevationAtUv: (u: number, v: number) => number;
  /** 経緯度から標高を引く。窓の外は null。 */
  elevationAt: (lng: number, lat: number) => number | null;
  /** 経緯度 → 切り出し窓の中の相対位置 (0..1)。 */
  toUv: (lng: number, lat: number) => [number, number];
}

/** 全面が海のタイルは存在せず 404 になる。terrarium の -200m 相当で埋める。 */
const SEA_FILL = "rgb(127,56,0)";

/**
 * 指定した窓の DEM を読む。
 *
 * `signal` を渡すと読み込みを中断できる (画面から外れた・アンマウントした)。
 */
export async function loadDem({
  z = 12,
  view,
  signal,
}: {
  z?: number;
  view: DemView;
  signal?: AbortSignal;
}): Promise<Dem> {
  const txMin = lngToTileX(view.west, z);
  const txMax = lngToTileX(view.east, z);
  const tyMin = latToTileY(view.north, z);
  const tyMax = latToTileY(view.south, z);
  const x0 = Math.floor(txMin);
  const x1 = Math.ceil(txMax) - 1;
  const y0 = Math.floor(tyMin);
  const y1 = Math.ceil(tyMax) - 1;
  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;

  const mosaic = document.createElement("canvas");
  mosaic.width = nx * DEM_TILE_SIZE;
  mosaic.height = ny * DEM_TILE_SIZE;
  const mctx = mosaic.getContext("2d", { willReadFrequently: true });
  if (!mctx) throw new Error("2d context unavailable");

  let missed = 0;
  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const px = (x - x0) * DEM_TILE_SIZE;
      const py = (y - y0) * DEM_TILE_SIZE;
      const url = DEM_TILE_TEMPLATE.replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      jobs.push(
        (async () => {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            // 海のタイルは存在しない。落とさずに埋めて続ける。
            missed++;
            mctx.fillStyle = SEA_FILL;
            mctx.fillRect(px, py, DEM_TILE_SIZE, DEM_TILE_SIZE);
            return;
          }
          const bitmap = await createImageBitmap(await response.blob());
          mctx.drawImage(bitmap, px, py, DEM_TILE_SIZE, DEM_TILE_SIZE);
          bitmap.close();
        })()
      );
    }
  }
  await Promise.all(jobs);

  const cropX = Math.floor((txMin - x0) * DEM_TILE_SIZE);
  const cropY = Math.floor((tyMin - y0) * DEM_TILE_SIZE);
  const cropW = Math.max(2, Math.round((txMax - txMin) * DEM_TILE_SIZE));
  const cropH = Math.max(2, Math.round((tyMax - tyMin) * DEM_TILE_SIZE));
  const pixels = mctx.getImageData(cropX, cropY, cropW, cropH).data;

  const native = new Float32Array(cropW * cropH);
  for (let i = 0, p = 0; i < native.length; i++, p += 4) {
    native[i] = pixels[p] * 256 + pixels[p + 1] + pixels[p + 2] / 256 - 32768;
  }

  function resample(width: number, height: number): DemGrid {
    const grid = new Float64Array(width * height);
    const sx = cropW / width;
    const sy = cropH / height;
    if (sx >= 1.2 || sy >= 1.2) {
      for (let j = 0; j < height; j++) {
        const j0 = Math.floor(j * sy);
        const j1 = Math.max(j0 + 1, Math.min(cropH, Math.floor((j + 1) * sy)));
        for (let i = 0; i < width; i++) {
          const i0 = Math.floor(i * sx);
          const i1 = Math.max(i0 + 1, Math.min(cropW, Math.floor((i + 1) * sx)));
          let sum = 0;
          let count = 0;
          for (let jj = j0; jj < j1; jj++) {
            for (let ii = i0; ii < i1; ii++) {
              sum += native[jj * cropW + ii];
              count++;
            }
          }
          grid[j * width + i] = sum / count;
        }
      }
    } else {
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          grid[j * width + i] = bilinear(
            native,
            cropW,
            cropH,
            (i + 0.5) * sx - 0.5,
            (j + 0.5) * sy - 0.5
          );
        }
      }
    }
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] < min) min = grid[i];
      if (grid[i] > max) max = grid[i];
    }
    return { grid, width, height, min, max };
  }

  const elevationAtUv = (u: number, v: number) =>
    bilinear(native, cropW, cropH, u * cropW - 0.5, v * cropH - 0.5);

  const toUv = (lng: number, lat: number): [number, number] => [
    (lngToTileX(lng, z) - txMin) / (txMax - txMin),
    (latToTileY(lat, z) - tyMin) / (tyMax - tyMin),
  ];

  const elevationAt = (lng: number, lat: number) => {
    const [u, v] = toUv(lng, lat);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return elevationAtUv(u, v);
  };

  return {
    z,
    view,
    tiles: nx * ny,
    missed,
    resample,
    elevationAtUv,
    elevationAt,
    toUv,
  };
}

/** 3x3 箱平滑。等高線のギザつきを取る。 */
export function smoothGrid(
  grid: Float64Array,
  width: number,
  height: number,
  passes = 1
): Float64Array {
  let source = grid;
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(width * height);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        let sum = 0;
        let count = 0;
        for (let jj = Math.max(0, j - 1); jj <= Math.min(height - 1, j + 1); jj++) {
          for (let ii = Math.max(0, i - 1); ii <= Math.min(width - 1, i + 1); ii++) {
            sum += source[jj * width + ii];
            count++;
          }
        }
        next[j * width + i] = sum / count;
      }
    }
    source = next;
  }
  return source;
}

/**
 * 枠の幅から MapLibre のズームを決める。
 *
 * 「枠の幅いっぱいで経度 `spanLng` 度を見せる」= 産地が変わっても同じ縮尺になる。
 * MapLibre の世界幅は `512 * 2^zoom` px。
 */
export function zoomForLngSpan(containerWidth: number, spanLng: number): number {
  return Math.log2((360 * Math.max(1, containerWidth)) / (512 * spanLng));
}
