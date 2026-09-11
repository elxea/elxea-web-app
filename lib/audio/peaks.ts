/**
 * 波形 (peaks) の供給。
 *
 * ## なぜ事前計算か
 *
 * 波形を出すのに素直なのは `AudioContext.decodeAudioData` だが、それは音源を
 * **全量ダウンロードして丸ごとデコード**する。数十 MB のインタビュー音声で
 * これをやると、再生が始まる前に回線とメモリを持っていかれる (SP では失敗も
 * する)。SoundCloud も波形は事前計算したものを配信していて、クライアントで
 * デコードはしない。
 *
 * よってこの層は「振幅を 0..1 に正規化した短い配列」を受け取るだけにし、
 * 生成は `scripts/audio/generate-peaks.mjs` (ffmpeg) がビルド前に済ませる。
 *
 * ## 優先順位
 *
 * 1. トラックが `peaks` を直接持っていればそれ (CMS が持たせる場合)
 * 2. `public/audio/peaks/<key>.json` にあればそれ (生成スクリプトの出力)
 * 3. どちらも無ければ src から決定的に合成したプレースホルダ
 *
 * 3 を用意しているのは、音源が差し替わった直後や未生成の音源でも
 * 「波形が出ない・掴めない」を起こさないため。合成波形は **src が同じなら
 * 常に同じ形**になるので、SSR と CSR で描き分かれることもない。
 */

/** 波形の分解能。SoundCloud の見た目に寄せた本数。 */
export const PEAKS_BUCKETS = 200;

/**
 * FNV-1a 32bit。ハッシュ用途のみで暗号強度は不要。
 *
 * 生成スクリプト (`scripts/audio/generate-peaks.mjs`) と **同じ実装**を持つ。
 * 片方だけ変えると保存先とルックアップ先がずれて波形が見つからなくなるため、
 * 変更するときは必ず両方を直すこと。
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32bit の FNV prime 乗算。Math.imul で桁溢れを 32bit に畳む。
    hash = Math.imul(hash, 0x01000193);
  }
  // 符号なし 32bit の 16 進 8 桁に揃える。
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 音源 URL から peaks ファイルのキーを作る。 */
export function peaksKey(src: string): string {
  return hashString(src);
}

/** peaks JSON の公開パス。 */
export function peaksUrl(src: string): string {
  return `/audio/peaks/${peaksKey(src)}.json`;
}

/**
 * src から決定的にそれらしい波形を合成する。
 *
 * 乱数は使わない。使うと再描画のたびに形が変わり、SSR と CSR でも食い違う。
 * 複数の正弦波を重ねているのは、単調な鋸波だと「読み込み中の飾り」に見えて
 * 掴めることが伝わらないため。
 */
export function synthesizePeaks(src: string, buckets: number = PEAKS_BUCKETS): number[] {
  const seed = parseInt(hashString(src), 16);
  const out: number[] = new Array(buckets);

  for (let i = 0; i < buckets; i += 1) {
    const t = i / buckets;
    // seed から位相をずらし、音源ごとに違う形にする。
    const a = Math.sin(t * Math.PI * 2 * 3 + (seed % 97)) * 0.5 + 0.5;
    const b = Math.sin(t * Math.PI * 2 * 7 + (seed % 31)) * 0.5 + 0.5;
    const c = Math.sin(t * Math.PI * 2 * 13 + (seed % 13)) * 0.5 + 0.5;
    // 端を少し絞って、始まりと終わりがフェードして見えるようにする。
    const envelope = Math.sin(Math.PI * t) ** 0.35;
    const v = (a * 0.5 + b * 0.3 + c * 0.2) * envelope;
    // 0 のバケットがあると掴める帯が途切れて見えるので下限を持たせる。
    out[i] = Math.min(1, Math.max(0.08, v));
  }

  return out;
}

/** 生の振幅配列を 0..1 に正規化し、指定本数に均す。 */
export function normalizePeaks(values: number[], buckets: number = PEAKS_BUCKETS): number[] {
  if (values.length === 0) return [];

  const max = values.reduce((m, v) => (v > m ? v : m), 0);
  // 無音 (全部 0) を 0 除算せずに返す。
  if (max <= 0) return new Array(buckets).fill(0.08);

  const out: number[] = new Array(buckets);
  const ratio = values.length / buckets;

  for (let i = 0; i < buckets; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let peak = 0;
    for (let j = start; j < end && j < values.length; j += 1) {
      const v = values[j];
      if (v > peak) peak = v;
    }
    out[i] = Math.min(1, Math.max(0.08, peak / max));
  }

  return out;
}
