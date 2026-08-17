import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";

import { BGM_URL } from "@/lib/audio/bgm-source";

import {
  ArticleAudioProvider,
  useArticleAudio,
  type ArticleAudioTrack,
} from "./article-audio-provider";
import { AudioDock } from "./audio-dock";
import { TrackRow } from "./track-row";

/**
 * AudioDock — 画面下端に常駐するプレイヤー (SoundCloud 方式)。
 *
 * ## 実際に鳴らせる story
 *
 * バーは「音源が選ばれている」ときだけ出る。選ぶ口は曲リスト (`TrackRow`) なので、
 * story も本番と同じ組み合わせで置いてある: `ArticleAudioProvider` の中に
 * 曲リストと `AudioDock` を並べ、行を押すと下からバーが上がってくる。
 *
 * - 音源は Vercel Blob の公開ファイル (`lib/audio/bgm-source.ts` が唯一の定義箇所)。
 *   リポジトリには音源を置いていないので **ネットワークが要る**
 * - 波形は事前計算した `public/audio/peaks/<key>.json` を取りに行く。
 *   Storybook は `staticDirs: ["../public"]` で同じパスを配るので、本番と同じ
 *   波形が出る。未生成の音源では src から合成した波形に落ちる
 *   (`SynthesizedWaveform` の story がその状態)
 * - 波形は掴んで擦れる。指を離した位置で再生位置が確定する
 * - 右端の `^` で全画面パネルが開く。Escape で閉じる
 *
 * ## 自動再生について
 *
 * ブラウザはユーザー操作なしの再生を拒否する。story を開いただけでは音は出ず、
 * 行か再生ボタンを 1 度押す必要がある (本番と同じ挙動)。
 */
const meta = {
  title: "Audio/AudioDock",
  component: AudioDock,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof AudioDock>;

export default meta;

type Story = StoryObj<typeof meta>;

/** story で鳴らす音源。事前計算済みの波形 JSON があるもの。 */
const TRACK_WITH_PEAKS: ArticleAudioTrack = {
  id: "roji-1",
  src: BGM_URL,
  title: "露 地 の 音",
  album: "elxea / roji",
  href: "/journal",
};

/**
 * 波形 JSON を持たない音源。`peaksUrl` の 404 は想定内で、src から決定的に
 * 合成した波形へ落ちる (掴んで擦れる点は同じ)。
 */
const TRACK_WITHOUT_PEAKS: ArticleAudioTrack = {
  id: "roji-2",
  src: `${BGM_URL}?variant=story-no-peaks`,
  title: "波 形 未 生 成 の 音 源",
  album: "elxea / roji",
};

/** CMS が波形を直接持っている場合 (フェッチしない経路)。 */
const TRACK_INLINE_PEAKS: ArticleAudioTrack = {
  id: "roji-3",
  src: `${BGM_URL}?variant=story-inline-peaks`,
  title: "波 形 を 直 接 持 つ 音 源",
  album: "elxea / roji",
  peaks: Array.from({ length: 200 }, (_, i) =>
    Math.abs(Math.sin(i / 7) * 0.6 + Math.sin(i / 23) * 0.35)
  ),
};

/** 曲リスト + 下部バー。本番の記事ページと同じ組み合わせ。 */
function DockStage({ tracks }: { tracks: readonly ArticleAudioTrack[] }) {
  const t = useTranslations("journal");

  return (
    <ArticleAudioProvider>
      <div className="min-h-svh bg-background pb-32">
        <div className="mx-auto w-full max-w-2xl px-6 py-16">
          <p className="text-xs tracking-[0.42em] text-muted-foreground">
            T R A C K S
          </p>
          <p className="mt-6 text-sm leading-loose text-muted-foreground">
            行を押すと再生が始まり、画面下端にバーが上がってきます。波形は掴んで擦れます。
          </p>
          <div className="mt-10 divide-y divide-border">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                labels={{ play: t("audioPlay"), pause: t("audioPause") }}
              />
            ))}
          </div>
        </div>
      </div>
      <AudioDock />
    </ArticleAudioProvider>
  );
}

/** 既定 — 3 つの音源を並べ、波形の 3 経路 (事前計算 / 合成 / 直接) を比べる。 */
export const Playable: Story = {
  render: () => (
    <DockStage
      tracks={[TRACK_WITH_PEAKS, TRACK_WITHOUT_PEAKS, TRACK_INLINE_PEAKS]}
    />
  ),
};

/** 事前計算した波形だけ。本番の記事音声と同じ状態。 */
export const PrecomputedWaveform: Story = {
  render: () => <DockStage tracks={[TRACK_WITH_PEAKS]} />,
};

/** 波形 JSON が無い音源。src から合成した波形に落ちる (404 は異常ではない)。 */
export const SynthesizedWaveform: Story = {
  render: () => <DockStage tracks={[TRACK_WITHOUT_PEAKS]} />,
};

/**
 * 波形シークは **全画面パネルの中**にある (バーは経過と総尺だけを出す)。
 * バー中央を押せば開くが、story ではその 1 手を省いて「開いた状態」から始める。
 *
 * `useArticleAudio()` の `toggle` と `setExpanded` を同じクリックで呼ぶだけで、
 * dock の内部状態には触っていない (本番と同じ公開 API しか使わない)。
 * 押すのが本物のクリックなので、ブラウザの自動再生制限にも掛からない。
 */
export const ExpandedPanel: Story = {
  render: () => (
    <ArticleAudioProvider>
      <div className="min-h-svh bg-background">
        <div className="mx-auto w-full max-w-2xl px-6 py-16">
          <OpenExpandedButton track={TRACK_WITH_PEAKS} />
        </div>
      </div>
      <AudioDock />
    </ArticleAudioProvider>
  ),
};

function OpenExpandedButton({ track }: { track: ArticleAudioTrack }) {
  const { toggle, setExpanded } = useArticleAudio();

  return (
    <button
      type="button"
      onClick={() => {
        toggle(track);
        setExpanded(true);
      }}
      className="rounded-md border border-border px-4 py-3 text-sm text-foreground hover:bg-muted"
    >
      再生してプレイヤーを開く
    </button>
  );
}

/**
 * 読み込めない音源。`error` に落ち、経過・総尺は `--:--` のまま
 * シークが不能に見える (「押しても無言」の窓を作らない)。
 */
export const SourceError: Story = {
  render: () => (
    <DockStage
      tracks={[
        {
          id: "broken",
          src: "/audio/this-file-does-not-exist.mp3",
          title: "読 め な い 音 源",
        },
      ]}
    />
  ),
};
