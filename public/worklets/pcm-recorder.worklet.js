/**
 * マイク入力を 16kHz・モノラル・16bit の生データに変換して本体スレッドへ渡す。
 *
 * なぜ AudioWorklet か:
 * 一般的な録音機能 (MediaRecorder) はこの形式を出せない (webm/opus など容器付き
 * の圧縮形式しか出さない)。Hume は「16kHz・モノラル・linear16」を要求するので、
 * 生のサンプルを自分で取れる AudioWorklet 以外に道が無い。
 *
 * なぜ自分で 16kHz に揃えるか:
 * AudioContext の実サンプルレートは端末が決める (44,100 / 48,000 が多い)。Hume に
 * 申告した値と実際に送る音の値がずれると、**丸ごと無音として扱われる** (音が歪む
 * のではなく、何も話していないことになる)。だから申告値に合わせてこちらで間引く。
 *
 * このファイルは「形式変換」しかしない。いつ開くか・いつ閉じるか・無音を送るか
 * といった方針は一切持たない (`lib/voice/mic-stream.ts` が決める)。
 *
 * 受け取る設定 (`processorOptions`):
 * - `targetSampleRate` 変換後のサンプルレート (例: 16000)
 * - `frameSize`        1 回に本体へ渡すサンプル数 (例: 320 = 16kHz の 20ms)
 *
 * 本体へ渡すもの: `ArrayBuffer` (Int16Array のリトルエンディアン表現) を transfer。
 * 本体から受け取るもの: `{ type: "stop" }` で自分を終了する。
 */

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_SIZE = 320;

/** -1.0〜1.0 の浮動小数を 16bit 整数に丸める (範囲外は端で止める)。 */
function toInt16(sample) {
  if (sample > 1) return 0x7fff;
  if (sample < -1) return -0x8000;
  return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
}

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = (options && options.processorOptions) || {};
    const targetSampleRate = processorOptions.targetSampleRate || DEFAULT_TARGET_SAMPLE_RATE;

    this.frameSize = processorOptions.frameSize || DEFAULT_FRAME_SIZE;
    // `sampleRate` は AudioWorkletGlobalScope の global (この context の実レート)。
    this.step = sampleRate / targetSampleRate;
    // 間引きの読み取り位置。ブロックをまたいで小数部を持ち越さないと、ブロック
    // 境界ごとに数サンプルずつ足りない / 余る音になり、長い発話ほどずれが積もる。
    this.cursor = 0;
    this.frame = new Int16Array(this.frameSize);
    this.frameIndex = 0;
    this.running = true;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "stop") {
        this.flush();
        this.running = false;
      }
    };
  }

  /** 溜まりかけのフレームを端数のまま本体へ渡す (停止時の取りこぼし防止)。 */
  flush() {
    if (this.frameIndex === 0) return;
    const partial = this.frame.slice(0, this.frameIndex);
    this.frameIndex = 0;
    this.port.postMessage(partial.buffer, [partial.buffer]);
  }

  process(inputs) {
    if (!this.running) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // モノラルに落とす。複数チャンネルが来ても 1 本目だけを使う (マイク取得時に
    // channelCount: 1 を要求しているので通常は 1 本しか来ない)。
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    while (this.cursor < channel.length) {
      const index = Math.floor(this.cursor);
      const fraction = this.cursor - index;
      const current = channel[index];
      // 次のサンプルが同じブロックに無いときは現在値で止める。境界の 1 サンプル
      // だけ線形補間が効かないが、16kHz で 20ms ごとに 1 回、可聴域には出ない。
      const next = index + 1 < channel.length ? channel[index + 1] : current;

      this.frame[this.frameIndex] = toInt16(current + (next - current) * fraction);
      this.frameIndex += 1;

      if (this.frameIndex === this.frameSize) {
        const full = this.frame.slice(0);
        this.frameIndex = 0;
        this.port.postMessage(full.buffer, [full.buffer]);
      }

      this.cursor += this.step;
    }

    this.cursor -= channel.length;
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorderProcessor);
