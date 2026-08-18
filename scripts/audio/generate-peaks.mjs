#!/usr/bin/env node
/**
 * 音源から波形 (peaks) を事前計算して `public/audio/peaks/<key>.json` に書く。
 *
 * クライアントで `decodeAudioData` を回すと音源を全量落として丸ごとデコードする
 * ことになるので、波形はここで作って静的配信する (`lib/audio/peaks.ts` 参照)。
 *
 * 使い方:
 *   node scripts/audio/generate-peaks.mjs <音源の URL か ローカルパス> [...]
 *
 * 例:
 *   node scripts/audio/generate-peaks.mjs public/audio/bgm.mp3
 *   node scripts/audio/generate-peaks.mjs https://example.com/audio/interview.mp3
 *
 * 前提: `ffmpeg` が PATH にあること。
 *
 * キーは音源 URL の FNV-1a ハッシュで、`lib/audio/peaks.ts` の `hashString` と
 * **同じ実装**でなければならない (ずれるとルックアップが外れて波形が出ない)。
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/** 波形の分解能。lib/audio/peaks.ts の PEAKS_BUCKETS と揃えること。 */
const BUCKETS = 200;
const OUT_DIR = path.join(process.cwd(), "public", "audio", "peaks");

/** FNV-1a 32bit。lib/audio/peaks.ts の hashString と同一実装。 */
function hashString(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * ffmpeg で 8kHz mono 16bit PCM に落として標準出力から受け取る。
 *
 * 波形の見た目に必要なのは包絡線だけなので、サンプルレートは思い切り落とす。
 * 44.1kHz のまま扱うと数十 MB の音源で無駄にメモリを食う。
 */
function decodeToPcm(input) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-i", input,
      "-f", "s16le",     // 生 PCM 16bit little endian
      "-ac", "1",        // mono
      "-ar", "8000",     // 8kHz で十分
      "-loglevel", "error",
      "pipe:1",
    ]);

    const chunks = [];
    let stderr = "";

    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => { stderr += c.toString(); });
    ff.on("error", (err) => {
      reject(new Error(`ffmpeg を起動できません (PATH にありますか): ${err.message}`));
    });
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg が失敗しました (exit ${code})\n${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/** PCM を BUCKETS 本の 0..1 振幅に畳む。各バケットは絶対値のピークを採る。 */
function pcmToPeaks(pcm) {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) throw new Error("デコード結果が空です (音声トラックがない可能性)");

  const perBucket = sampleCount / BUCKETS;
  const peaks = new Array(BUCKETS).fill(0);

  for (let i = 0; i < BUCKETS; i += 1) {
    const start = Math.floor(i * perBucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * perBucket));
    let peak = 0;
    for (let j = start; j < end && j < sampleCount; j += 1) {
      const v = Math.abs(pcm.readInt16LE(j * 2));
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
  }

  const max = peaks.reduce((m, v) => (v > m ? v : m), 0);
  if (max <= 0) return peaks.map(() => 0.08);

  // 下限 0.08 は UI 側と同じ。0 のバケットで帯が途切れて見えるのを防ぐ。
  return peaks.map((v) => Math.min(1, Math.max(0.08, v / max)));
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error("使い方: node scripts/audio/generate-peaks.mjs <音源の URL か パス> [...]");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  let failed = 0;

  for (const input of inputs) {
    // キーは「アプリが実際に参照する src 文字列」で作る。ローカルパスを渡した
    // 場合でも、配信時の URL でキーを作らないとルックアップが外れる。
    const key = hashString(input);
    const outPath = path.join(OUT_DIR, `${key}.json`);

    try {
      const pcm = await decodeToPcm(input);
      const peaks = pcmToPeaks(pcm);
      // 小数は 3 桁で足りる。全桁出すと JSON が無駄に太る。
      const rounded = peaks.map((v) => Number(v.toFixed(3)));
      await writeFile(outPath, JSON.stringify({ src: input, buckets: BUCKETS, peaks: rounded }));
      console.log(`[OK]   ${input}\n       -> ${path.relative(process.cwd(), outPath)} (key=${key})`);
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] ${input}\n       ${err.message}`);
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
