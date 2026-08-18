"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronUpIcon, Loader2Icon, PauseIcon, PlayIcon, XIcon } from "lucide-react";

import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

import { formatTime, useArticleAudio } from "./article-audio-provider";
import { AudioWaveform } from "./audio-waveform";

/**
 * AudioDock — 画面下端に常駐するプレイヤーと、その全画面展開。
 *
 * SoundCloud Web の操作感を手本にしているが、模しているのは
 * **レイアウト構造と操作の作法だけ**。ロゴ・ブランドカラー等の要素は一切
 * 持ち込まない (Setaka 確定 2026-08-16)。色・字は roji のトークンから採る。
 *
 * ## 旧 MiniPlayer との違い
 *
 * 旧実装 (`mini-player.tsx`) は「本体プレイヤーが画面外に出たときだけ」
 * IntersectionObserver で出していた。つまり記事を上に戻すとバーが消え、
 * ページを移ると provider ごと消えて再生も止まっていた。
 *
 * 本コンポーネントは **音源が選ばれている限り常に出る**。provider は
 * ルートレイアウトに常駐しているので、記事を離れてもバーと再生が残る。
 *
 * ## 画面下端の取り合い (ChatBar との共存)
 *
 * 下端には ChatBar が既に居る (`components/chat/chat-bar.tsx`)。取り合いの
 * 解き方は**画面の広さで 2 通り**に分かれる (Setaka 裁定 2026-08-17)。
 *
 * ### 広い画面 — 縦に積んで両立させる
 *
 * - 音声バーが最下段。鳴っている音を止める手段は常に届く位置に要る (WCAG 2.2.2)。
 * - ChatBar はその上へ退く。`--audio-bar-h` を読んで自分の `bottom` を上げる。
 *
 * ### モバイルの全画面チャット — 音声バーを退避させる
 *
 * 全画面チャットが開いている間は、このバーを画面外へ退かせる (`motion-retreat`)。
 * 限られた操作スペースに主役を 2 つ並べるとノイズになり操作の邪魔になる
 * (Setaka「チャット操作時はチャットに集中すればいい。別に音声バーが上に下に
 * 隠れてもいい」)。
 *
 * - **再生は止めない**。音も再生位置もそのまま続く。退避は見た目だけの話で、
 *   `stop()` とは別物 (`isBarRetreated` / `retreatBar` は provider 側の SoT)。
 * - 退避中の `--audio-bar-h` は `0px`。この変数は「バーが下端で占めている高さ」
 *   を表すので、占めていない間は 0 でなければ他の下端 UI が宙に浮く。
 * - 退避中は `inert` を付けて操作対象から外す。透明で画面外の面がフォーカスや
 *   指を拾うと、見えないボタンを押せてしまう。
 * - 代わりの停止手段はチャットヘッダーの一時停止ボタンが引き継ぐ
 *   (`components/chat/chat-bar.tsx` の `RetreatedAudioToggle`)。**これが無いと
 *   鳴っている音を止められない画面になる** ので、退避と対で必ず置く。
 *
 * 退避を始めるのは要求側 (チャット) で、バーは要求されたことだけを見る。逆向き
 * (バーがチャットの開閉を見に行く) にすると音声側がチャットの実装に依存する。
 *
 * ### 重ね順
 *
 * 名前付き z レイヤー (`app/globals.css` の `--z-*` が SoT) に従う。
 * **チャットが音声バーより前**である (Setaka 裁定 2026-08-17):
 * - バー   `--z-sticky` (1020) … チャット `--z-chat` (1030) より後ろ
 * - 展開   `--z-modal`  (1050) … 自分で閉じられるモーダルなのでチャットより前
 *
 * 2026-08-17 以前は ChatBar 側が Tailwind の生スケール (`z-40` / `z-50`) を
 * 使っており、同じ stacking context で 1020 > 50 となって音声バーが常に前に
 * 出ていた。その結果チャットの入力欄がバーに覆われて押せなかった。下端固定
 * UI の z は生スケールで書かず、必ず `--z-*` から採る。
 */

/** バーの実高さ。ChatBar のオフセットと合わせるためここを SoT にする。 */
const BAR_HEIGHT_PX = 64;

/**
 * 自分自身のアニメーションの終わりだけを拾う。
 *
 * `animationend` は子から親へ上がってくるので、素で受けると中のアイコン等の
 * アニメーションでも発火してしまう (バーが出ている最中に消える、等)。
 */
function isOwnAnimationEnd(event: React.AnimationEvent<HTMLElement>) {
  return event.target === event.currentTarget;
}

export function AudioDock() {
  const t = useTranslations("journal");
  const {
    current,
    status,
    currentTime,
    duration,
    toggle,
    seek,
    stop,
    isExpanded,
    setExpanded,
    isBarRetreated,
  } = useArticleAudio();

  // 擦っている最中の見かけの位置。確定するまで実再生位置は動かさない。
  const [scrubRatio, setScrubRatio] = React.useState<number | null>(null);

  // --- 退出アニメを最後まで見せるための2つの「閉じかけ」状態 --------------
  // 素直に書くと `current` が消えた瞬間・`isExpanded` が false になった瞬間に
  // DOM から外れ、退出の動きが1フレームも再生されない。閉じる操作をいったん
  // ここで受け止め、`animationend` が来てから本当の状態を変える。
  const [barClosing, setBarClosing] = React.useState(false);
  const [panelClosing, setPanelClosing] = React.useState(false);

  const requestBarClose = () => setBarClosing(true);
  const finishBarClose = (event: React.AnimationEvent<HTMLElement>) => {
    if (!barClosing || !isOwnAnimationEnd(event)) return;
    setBarClosing(false);
    stop();
  };

  const requestPanelClose = React.useCallback(() => setPanelClosing(true), []);
  const finishPanelClose = (event: React.AnimationEvent<HTMLElement>) => {
    if (!panelClosing || !isOwnAnimationEnd(event)) return;
    setPanelClosing(false);
    setExpanded(false);
  };

  const openPanel = () => {
    setPanelClosing(false);
    setExpanded(true);
  };

  const isVisible = Boolean(current) && !barClosing;

  // --- ChatBar に自分の高さを知らせる ------------------------------------
  // 変数はルート要素に置く。ChatBar は DOM 上の兄弟なので、共通の祖先である
  // <html> 経由でしか渡せない。
  //
  // 意味は「バーがいま下端で占めている高さ」。よって出ていないときだけでなく
  // **退避中も 0px**。退避中に 64px を残すと、上に載っている ChatBar / ランチャ /
  // Cookie バーが、実体の無いバーのぶんだけ宙に浮く。
  // 閉じかけ (`barClosing`) の時点で 0px に落とすのは、上に載っている面が
  // バーが降りていくのと同じタイミングで一緒に下りるため。
  const occupiesBottom = isVisible && !isBarRetreated;
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--audio-bar-h", occupiesBottom ? `${BAR_HEIGHT_PX}px` : "0px");
    return () => {
      root.style.setProperty("--audio-bar-h", "0px");
    };
  }, [occupiesBottom]);

  // --- 展開中は背後のページを固める --------------------------------------
  React.useEffect(() => {
    if (!isExpanded) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [isExpanded]);

  // --- Escape で閉じる ----------------------------------------------------
  React.useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestPanelClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded, requestPanelClose]);

  if (!current) return null;

  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  const isError = status === "error";

  const total = duration;
  const progress = total && total > 0 ? Math.min(1, currentTime / total) : 0;
  const shownRatio = scrubRatio ?? progress;
  const shownTime = total && scrubRatio !== null ? scrubRatio * total : currentTime;

  const handleSeekRatio = (ratio: number) => {
    setScrubRatio(null);
    if (total && total > 0) seek(ratio * total);
  };

  const playPauseLabel = isPlaying ? t("audioPause") : t("audioPlay");

  const PlayPauseIcon = isLoading ? Loader2Icon : isPlaying ? PauseIcon : PlayIcon;

  return (
    <>
      {/* ================= 下部固定バー ================= */}
      <div
        data-slot="audio-dock-bar"
        // 退避中かどうかは DOM に出す。`motion-retreat` はこの属性を見て退く
        // (状態を class 名に混ぜないので、退避中かどうかを外から実測できる)。
        data-retreated={isBarRetreated}
        // 退避中は操作対象から外す。画面外に居るボタンを指やキーボードの
        // フォーカスが拾わないようにする (React 19 の `inert` 属性)。
        inert={isBarRetreated}
        style={{ zIndex: "var(--z-sticky)", height: BAR_HEIGHT_PX }}
        onAnimationEnd={finishBarClose}
        className={cn(
          "fixed inset-x-0 bottom-0 flex w-full items-center gap-2 border-t border-border bg-card px-2 lg:px-4",
          // バー付近を触ったときにページが動かないようにする。
          "[overscroll-behavior:contain]",
          // 画面の端に出入りする面なので `sheet` 型。下から上がってきて、
          // 閉じるときは1段速い時間で下へ戻る。
          "motion-from-bottom",
          barClosing ? "animate-sheet-out" : "animate-sheet-in",
          // 全画面チャットが開いている間だけ下へ退く (再生は続く)。`sheet` 系は
          // `transform`・こちらは `translate` プロパティを動かすので併用できる。
          "motion-retreat"
        )}
      >
        {/* 進捗は細い線で出すだけにして、掴めるのは展開後の波形に寄せる。
            バー全体が「展開する」当たりなので、ここも掴めるようにすると
            展開しようとした指がシークしてしまう (誤操作の温床)。 */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-muted">
          <div
            className="h-full bg-foreground transition-[width] duration-150 ease-linear"
            style={{ width: `${shownRatio * 100}%` }}
          />
        </div>

        <button
          type="button"
          onClick={() => toggle(current)}
          aria-label={playPauseLabel}
          aria-busy={isLoading}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            "transition-colors duration-fast",
            isLoading
              ? "bg-muted text-muted-foreground"
              : "bg-foreground text-background hover:bg-brand-charcoal",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          )}
        >
          <PlayPauseIcon
            aria-hidden="true"
            className={cn("size-4", isLoading ? "animate-spin" : "fill-current")}
          />
        </button>

        {/* バー中央を押すと展開する。<a> ではなく <button> にしているのは、
            誤タップでページ遷移が起きないようにするため (要件 4)。記事へ戻る
            導線は展開後に別途置く。 */}
        <button
          type="button"
          onClick={openPanel}
          aria-expanded={isExpanded}
          aria-label={t("audioExpand")}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left",
            "transition-colors duration-fast hover:bg-muted/60",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          <span className="min-w-0 flex-1">
            <span className={cn(bodySmClass, "block truncate text-foreground")}>
              {current.title}
            </span>
            <span className={cn(captionClass, "block truncate text-muted-foreground")}>
              {isError
                ? t("audioError")
                : isLoading
                  ? t("audioLoading")
                  : `${formatTime(shownTime)} / ${formatTime(total)}`}
            </span>
          </span>
          <ChevronUpIcon
            aria-hidden="true"
            className="hidden size-4 shrink-0 text-muted-foreground sm:block"
          />
        </button>

        <button
          type="button"
          onClick={requestBarClose}
          aria-label={t("audioClose")}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground",
            "transition-colors duration-fast hover:bg-muted",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </div>

      {/* ================= 全画面展開 ================= */}
      {isExpanded ? (
        <>
          <div
            aria-hidden="true"
            onClick={requestPanelClose}
            style={{ zIndex: "var(--z-overlay)" }}
            className={cn(
              "fixed inset-0 bg-foreground/40",
              // 面で覆うものなので位置は動かさない = `fade`。
              panelClosing ? "animate-fade-out" : "animate-fade"
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={current.title}
            data-slot="audio-dock-panel"
            style={{ zIndex: "var(--z-modal)", boxShadow: "var(--elevation-shadow-modal)" }}
            onAnimationEnd={finishPanelClose}
            className={cn(
              "fixed inset-0 flex flex-col bg-background",
              // PC は全画面を占めず、中央の大型パネルにする。
              "lg:inset-auto lg:bottom-6 lg:left-1/2 lg:h-auto lg:w-full lg:max-w-3xl",
              "lg:-translate-x-1/2 lg:rounded-lg lg:border lg:border-border",
              "[overscroll-behavior:contain]",
              // 下端のバーから続けて上がってくる面なので `sheet`。横位置合わせは
              // `translate` プロパティ側 (lg:-translate-x-1/2) に残るので、
              // `transform` を使う型と重ねても中央寄せは崩れない。
              "motion-from-bottom",
              panelClosing ? "animate-sheet-out" : "animate-sheet-in"
            )}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 lg:px-6">
              <p className={cn(captionClass, "text-muted-foreground")}>{t("audioNowPlaying")}</p>
              <button
                type="button"
                onClick={requestPanelClose}
                aria-label={t("audioCollapse")}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground",
                  "transition-colors duration-fast hover:bg-muted",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                <XIcon aria-hidden="true" className="size-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 px-4 pb-8 lg:px-6">
              {current.artworkUrl ? (
                // 装飾なので next/image ではなく素の img で足りる (CMS 由来の
                // 任意ドメインを next.config の許可リストに足さずに済む)。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.artworkUrl}
                  alt=""
                  className="mx-auto aspect-square w-full max-w-56 rounded-lg object-cover lg:max-w-40"
                />
              ) : null}

              <div className="flex flex-col gap-1 text-center">
                <p className="text-foreground">{current.title}</p>
                {current.album ? (
                  <p className={cn(captionClass, "text-muted-foreground")}>{current.album}</p>
                ) : null}
              </div>

              {/* 波形シーク。掴む対象はここに集約する。 */}
              <div className="flex flex-col gap-2">
                <AudioWaveform
                  src={current.src}
                  peaks={current.peaks}
                  progress={progress}
                  disabled={!total}
                  ariaLabel={t("audioSeek")}
                  onScrub={setScrubRatio}
                  onSeek={handleSeekRatio}
                  className="h-20 lg:h-24"
                />
                <div className="flex items-center justify-between">
                  <span className={cn(captionClass, "tabular-nums text-muted-foreground")}>
                    {formatTime(shownTime)}
                  </span>
                  <span className={cn(captionClass, "tabular-nums text-muted-foreground")}>
                    {formatTime(total)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => toggle(current)}
                  aria-label={playPauseLabel}
                  aria-busy={isLoading}
                  className={cn(
                    "flex size-16 shrink-0 items-center justify-center rounded-full",
                    "transition-colors duration-fast",
                    isLoading
                      ? "bg-muted text-muted-foreground"
                      : "bg-foreground text-background hover:bg-brand-charcoal",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                  )}
                >
                  <PlayPauseIcon
                    aria-hidden="true"
                    className={cn("size-6", isLoading ? "animate-spin" : "fill-current")}
                  />
                </button>
              </div>

              {isError ? (
                <p role="alert" className={cn(captionClass, "text-center text-destructive")}>
                  {t("audioError")}
                </p>
              ) : null}

              {/* 記事へ戻る導線は展開後にだけ置く。バーに置くと誤タップで
                  意図しない遷移が起きる (要件 4)。 */}
              {current.href ? (
                <Link
                  href={current.href}
                  onClick={() => setExpanded(false)}
                  className={cn(
                    captionClass,
                    "mx-auto inline-flex min-h-11 items-center rounded-full border border-border px-5",
                    "text-foreground transition-colors duration-fast hover:bg-muted",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                >
                  {t("audioOpenArticle")}
                </Link>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
