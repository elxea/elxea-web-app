/**
 * 同じ失敗が鳴り続けて、他の失敗を埋めてしまうのを防ぐ（憲章 Wave 3）。
 *
 * ## なぜ要るか
 *
 * Wave 3 で境界の失敗を全部 Sentry に載せた。そのうちいくつかは**通りすがりの
 * 誰でも起こせる**。たとえば `decryptToken` は cookie を復号するだけの関数で、
 * `shop_at` に出鱈目な文字列を入れた requests を投げれば、認証を通らないまま
 * いくらでも失敗させられる。素直に全部送ると、
 *
 *   - 本当に鳴ってほしい失敗 (決済・契約) が件数に埋もれる
 *   - アラートが「いつも赤い」状態になり、**誰も見なくなる**
 *
 * つまり可視化のために足した装置が、可視化を壊す。R1 は「失敗が届くこと」を
 * 求めているのであって「全部送ること」を求めてはいないので、**届く形を保つ側**
 * を採る。
 *
 * ## どう捌くか
 *
 * event 名ごとに「1 分あたり 10 件まで」。超えた分は数えるだけにして、次に
 * 送れるようになったときに `suppressed` として件数を添える。**最初の数件は
 * 必ず送る**ので、新しい障害の第一報が遅れることはない。件数も失われない。
 *
 * ## 限界 (承知のうえ)
 *
 * 数え上げはプロセス内にしか無い。Vercel は同時に多数のインスタンスを立てるので、
 * 全体としては「インスタンス数 × 10 件/分」まで出る。共有の数え場所 (Redis 等) を
 * 置けば厳密にできるが、費用と依存が増えるうえ、目的である「桁で減らす」には
 * これで足りる。厳密さより、依存を増やさないことを採った。
 */

/** 数える窓の長さ。 */
const WINDOW_MS = 60_000;

/** 1 窓あたり Sentry へ送る上限。 */
const MAX_PER_WINDOW = 10;

/**
 * 覚えておく event 名の上限。event 名は固定文字列である約束だが、うっかり
 * テンプレート文字列を渡されると際限なく増える。増え方そのものが事故なので、
 * 上限で頭打ちにする (取りこぼしは「多めに送る」側に倒れる)。
 */
const MAX_TRACKED_EVENTS = 500;

type Bucket = {
  windowStart: number;
  sent: number;
  suppressed: number;
};

const buckets = new Map<string, Bucket>();

export type Admission = {
  /** Sentry へ送ってよいか。 */
  allow: boolean;
  /** 前回送ってから伏せた件数 (`allow` が true のときだけ意味を持つ)。 */
  suppressed: number;
};

/**
 * この event を今送ってよいかを決める。
 *
 * @param now テスト用。既定は現在時刻。
 */
export function admit(event: string, now: number = Date.now()): Admission {
  if (buckets.size > MAX_TRACKED_EVENTS) buckets.clear();

  const bucket = buckets.get(event);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    const suppressed = bucket?.suppressed ?? 0;
    buckets.set(event, { windowStart: now, sent: 1, suppressed: 0 });
    return { allow: true, suppressed };
  }

  if (bucket.sent < MAX_PER_WINDOW) {
    bucket.sent += 1;
    const suppressed = bucket.suppressed;
    bucket.suppressed = 0;
    return { allow: true, suppressed };
  }

  bucket.suppressed += 1;
  return { allow: false, suppressed: bucket.suppressed };
}

/** テスト用。プロセスをまたいだ状態を持ち越さないため。 */
export function resetThrottle(): void {
  buckets.clear();
}
