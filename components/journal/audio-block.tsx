"use client";

import * as React from "react";

import { ImageCard } from "@/components/media/image-card";
import { captionClass } from "@/components/editorial/rule-list";
import { AudioPlayer } from "@/components/audio/audio-player";
import { MiniPlayer } from "@/components/audio/mini-player";
import { TrackRow } from "@/components/audio/track-row";
import {
  ArticleAudioProvider,
  type ArticleAudioTrack,
} from "@/components/audio/article-audio-provider";
import { cn } from "@/lib/utils";

/**
 * AudioBlock — Figma `AudioBlock / Track` (8181:5288) と
 * `AudioBlock / Interview` (8174:63)。
 *
 * 記事内で音を聴かせる枠。2 つの variant の違いは Figma の注記どおり
 * 「楽曲版はジャケット・曲リスト・外部リンクを持つ / インタビュー版は持たない」。
 * インタビューを外部の配信サービスへ上げない方針を UI 上でも明示するため、
 * インタビュー版は送客ボタンを置かず注記で代替する。
 *
 * 外部連携は SoundCloud 1 本に限定 (Figma の注記)。他サービスのボタンは足さない。
 *
 * Figma 実測 (px) → 実装:
 * - 楽曲     PC 720 / p 24 / 面 mode/background / 1px border / radius-lg
 *            SP 343 / p 16 (単純縮小ではなくジャケットを全幅へ置き直す)
 *            PC は ジャケット 200 角 + 右に情報、SP は ジャケット全幅 + 縦積み
 * - 情報 gap PC 12 / ブロック内 gap 16
 * - インタビュー 720 / p 24 / 面 mode/card / 1px border / radius-lg
 * - 見出し前の小見出し caption 12 muted-foreground
 * - タイトル h4 16 / 500、メタ caption 12
 */

export type AudioBlockTrack = {
  id: string;
  title: string;
  src: string;
  /** CMS が持っている長さ (秒)。 */
  durationSeconds?: number | null;
};

export type AudioBlockLabels = {
  play: string;
  pause: string;
  loading: string;
  seek: string;
  error: string;
  close: string;
  nowPlaying: string;
  trackListLabel: string;
  externalNote: string;
  interviewNote: string;
};

type CommonProps = {
  /** 行動ログに残す記事 slug。 */
  contentId: string;
  /** ブロック上部の小見出し (「この号の音楽」「インタビュー音声」)。 */
  kicker: string;
  title: string;
  /** 「選曲: elxea 編集部 / 6 曲 · 27 分」等。 */
  meta?: string;
  labels: AudioBlockLabels;
  className?: string;
};

export type AudioBlockProps =
  | (CommonProps & {
      variant: "track";
      coverUrl?: string;
      tracks: AudioBlockTrack[];
      /** SoundCloud の URL。無ければ送客ボタンを出さない。 */
      soundcloudUrl?: string;
    })
  | (CommonProps & {
      variant: "interview";
      src: string;
    });

/**
 * 音源の状態は provider が持つので、本体・曲リスト・MiniPlayer をまとめて
 * その内側に置く。provider を記事ページ側ではなくここに置いているのは、
 * 「音声のあるブロックが 1 つも無い記事では audio 要素も作らない」ため。
 */
export function AudioBlock(props: AudioBlockProps) {
  return (
    <ArticleAudioProvider
      contentId={props.contentId}
      kind={props.variant === "interview" ? "interview" : "track"}
    >
      <AudioBlockInner {...props} />
    </ArticleAudioProvider>
  );
}

function AudioBlockInner(props: AudioBlockProps) {
  const { kicker, title, meta, labels, className } = props;
  const anchorRef = React.useRef<HTMLDivElement | null>(null);

  const playerLabels = {
    play: labels.play,
    pause: labels.pause,
    loading: labels.loading,
    seek: labels.seek,
    error: labels.error,
  };

  if (props.variant === "interview") {
    const track: ArticleAudioTrack = {
      id: "interview",
      src: props.src,
      title,
      artworkUrl: undefined,
    };
    return (
      <>
        <section
          data-slot="audio-block"
          data-variant="interview"
          ref={anchorRef}
          className={cn(
            "mt-6 flex w-full flex-col gap-4 rounded-lg border border-border bg-card p-6",
            className
          )}
        >
          <p className={cn(captionClass, "text-muted-foreground")}>{kicker}</p>
          <p data-slot="empty-state-title" className="text-foreground">
            {title}
          </p>
          {meta ? <p className={cn(captionClass, "text-muted-foreground")}>{meta}</p> : null}
          <AudioPlayer track={track} labels={playerLabels} />
          {/* Spotify 等へは上げない方針 (Setaka 確定 2026-08-11) を UI にも書く。
              置いていないボタンの不在は理由が伝わらないため。 */}
          <p className={cn(captionClass, "text-muted-foreground")}>{labels.interviewNote}</p>
        </section>
        <MiniPlayer
          anchorRef={anchorRef}
          labels={{
            play: labels.play,
            pause: labels.pause,
            close: labels.close,
            nowPlaying: labels.nowPlaying,
          }}
        />
      </>
    );
  }

  const { coverUrl, tracks, soundcloudUrl } = props;
  const audioTracks: ArticleAudioTrack[] = tracks.map((t) => ({
    id: t.id,
    src: t.src,
    title: t.title,
    album: title,
    artworkUrl: coverUrl,
  }));
  const leadTrack = audioTracks[0];

  return (
    <>
      <section
        data-slot="audio-block"
        data-variant="track"
        ref={anchorRef}
        className={cn(
          "mt-6 flex w-full flex-col gap-4 rounded-lg border border-border bg-background p-4 lg:p-6",
          className
        )}
      >
        <p className={cn(captionClass, "text-muted-foreground")}>{kicker}</p>

        {/* PC はジャケット 200 角の横並び、SP はジャケット全幅の縦積み。
            単純縮小ではなく組み替える (Figma 8181:5254)。 */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="w-full shrink-0 overflow-hidden rounded-md lg:w-50">
            <ImageCard image={coverUrl} alt={title} style={{ aspectRatio: "1/1" }} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p data-slot="empty-state-title" className="text-foreground">
              {title}
            </p>
            {meta ? <p className={cn(captionClass, "text-muted-foreground")}>{meta}</p> : null}
            {leadTrack ? <AudioPlayer track={leadTrack} labels={playerLabels} /> : null}
          </div>
        </div>

        {audioTracks.length > 0 ? (
          <div className="flex w-full flex-col">
            <h3 className="sr-only">{labels.trackListLabel}</h3>
            {audioTracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                fallbackDuration={tracks[index]?.durationSeconds ?? null}
                labels={{ play: labels.play, pause: labels.pause }}
              />
            ))}
          </div>
        ) : null}

        {soundcloudUrl ? (
          <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-center">
            {/* 外部連携は SoundCloud 1 本に限定 (Figma の注記)。 */}
            <a
              href={soundcloudUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                captionClass,
                "inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-foreground",
                "transition-colors duration-200 hover:bg-muted active:bg-secondary",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              )}
            >
              SoundCloud
              <span aria-hidden="true">&#8599;</span>
            </a>
            <p className={cn(captionClass, "text-muted-foreground")}>{labels.externalNote}</p>
          </div>
        ) : null}
      </section>
      <MiniPlayer
        anchorRef={anchorRef}
        labels={{
          play: labels.play,
          pause: labels.pause,
          close: labels.close,
          nowPlaying: labels.nowPlaying,
        }}
      />
    </>
  );
}
