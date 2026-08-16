"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * モーション見本の本体。
 *
 * 表示の約束:
 *   - 速さは画面上部のトグル1つで全サンプルに効く (`--motion-enter-duration` /
 *     `--motion-exit-duration` を親で差し替えているだけ。型の定義は触らない)。
 *   - サンプルは「動きの型」ではなく **実際の部品の形** で見せる。型の名前だけ
 *     並べても速さの是非は判断できないため。
 *   - 各サンプルには使うトークン名を小さく添える。ここで見た動きが、そのまま
 *     どのトークンの話なのかを追えるようにする。
 *
 * 動きの型の定義そのものは `app/globals.css` のモーション節にある。この面には
 * 値を書かない (見本が正本になってしまうと二重管理になる)。
 */

/* ──────────────────────────────────────────────────────────────────────────
 * 速さ (Spec D-1)
 * ────────────────────────────────────────────────────────────────────────── */

interface Speed {
  id: "fast" | "normal" | "slow";
  step: string;
  label: string;
  /** 登場に使うトークン */
  enter: string;
  /** 退出に使うトークン (Spec B-1「退出は登場の1段下」) */
  exit: string;
  enterToken: string;
  exitToken: string;
}

const SPEEDS: readonly Speed[] = [
  {
    id: "fast",
    step: "S",
    label: "150ms",
    enter: "var(--motion-duration-fast)",
    exit: "var(--motion-duration-fast)",
    enterToken: "--motion-duration-fast",
    exitToken: "--motion-duration-fast",
  },
  {
    id: "normal",
    step: "M",
    label: "300ms",
    enter: "var(--motion-duration-normal)",
    exit: "var(--motion-duration-fast)",
    enterToken: "--motion-duration-normal",
    exitToken: "--motion-duration-fast",
  },
  {
    id: "slow",
    step: "L",
    label: "500ms",
    enter: "var(--motion-duration-slow)",
    exit: "var(--motion-duration-normal)",
    enterToken: "--motion-duration-slow",
    exitToken: "--motion-duration-normal",
  },
];

/* ──────────────────────────────────────────────────────────────────────────
 * 出入りの状態管理
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 「退出アニメが終わってから消す」ための最小の状態機械。
 *
 * 今の roji の部品はどれも `if (!open) return null` で即座に消しているので、
 * 退出の動きを付けても再生されない。ここで使っている
 * 「closing の間は描画を残し、`animationend` で初めて外す」形が、適用ステップで
 * オーディオバーや Cookie バーに入れることになる実装そのもの。
 */
function useReveal() {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  // 開いたまま「もう一度」を押したときに再生し直すための remount キー。
  const [runId, setRunId] = useState(0);

  const play = () => {
    setClosing(false);
    setVisible(true);
    setRunId((n) => n + 1);
  };

  const dismiss = () => {
    setClosing(true);
  };

  /** 退出アニメの終了で初めて DOM から外す。登場側の終了では何もしない。 */
  const onAnimationEnd = () => {
    if (closing) {
      setVisible(false);
      setClosing(false);
    }
  };

  return { visible, closing, runId, play, dismiss, onAnimationEnd };
}

/* ──────────────────────────────────────────────────────────────────────────
 * 表示の部品
 * ────────────────────────────────────────────────────────────────────────── */

function TokenList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

interface SampleProps {
  /** 部品名 (見出し) */
  title: string;
  /** どの型か */
  kind: string;
  /** 何を見るか (1-2行) */
  note: string;
  tokens: readonly string[];
  controls: React.ReactNode;
  children: React.ReactNode;
}

function Sample({ title, kind, note, tokens, controls, children }: SampleProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-medium">{title}</h3>
        <span className="font-mono text-xs text-muted-foreground">{kind}</span>
      </div>
      <p className="text-sm text-muted-foreground">{note}</p>
      <div className="relative isolate h-56 w-full overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">{controls}</div>
      <TokenList items={tokens} />
    </section>
  );
}

/** サンプル枠の中身 — 動かす対象の後ろに置く、文字のない「ページらしさ」。 */
function StageBackdrop({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col gap-3 p-5" aria-hidden="true">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="h-3 w-4/5 rounded-full bg-muted" />
      <div className="h-3 w-3/5 rounded-full bg-muted" />
      <div className="h-3 w-2/3 rounded-full bg-muted" />
      <div className="h-3 w-1/2 rounded-full bg-muted" />
    </div>
  );
}

/** モーダル / ドロワーの背後に敷く面。`fade` の見本そのもの。 */
function Scrim({
  closing,
  onAnimationEnd,
}: {
  closing: boolean;
  onAnimationEnd?: () => void;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 bg-overlay-scrim",
        closing ? "animate-fade-out" : "animate-fade",
      )}
      onAnimationEnd={onAnimationEnd}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * 本体
 * ────────────────────────────────────────────────────────────────────────── */

export function MotionShowcase() {
  const [speedId, setSpeedId] = useState<Speed["id"]>("normal");
  const speed = SPEEDS.find((s) => s.id === speedId) ?? SPEEDS[1];

  const modal = useReveal();
  const bar = useReveal();
  const menu = useReveal();
  const drawer = useReveal();
  const toast = useReveal();
  const zoomCompare = useReveal();

  // トーストは短命 (数秒で自ら消える) なのが本来の姿なので、見本でも自動で退出させる。
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const playToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toast.play();
    toastTimer.current = setTimeout(() => toast.dismiss(), 2400);
  };

  return (
    <main
      className="min-h-dvh bg-background text-foreground"
      style={
        {
          "--motion-enter-duration": speed.enter,
          "--motion-exit-duration": speed.exit,
        } as React.CSSProperties
      }
    >
      {/* 速さトグル — 全サンプル共通。ここだけ sticky にして、下までスクロール
          しても速さを変えながら見比べられるようにする。 */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <p className="text-sm font-medium">速さ</p>
          <div className="flex gap-2" role="group" aria-label="動きの速さ">
            {SPEEDS.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={s.id === speedId ? "default" : "outline"}
                aria-pressed={s.id === speedId}
                onClick={() => setSpeedId(s.id)}
              >
                {s.step} / {s.label}
              </Button>
            ))}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            登場 {speed.enterToken} / 退出 {speed.exitToken}
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-5 py-10">
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl">roji モーション見本</h1>
          <p className="text-sm leading-relaxed">
            動きの型5種を、実際の部品の形で置いた面。上の「速さ」を切り替えると
            すべてのサンプルが同じ速さで動くので、同じ動きのまま
            150 / 300 / 500ms を見比べられる。設計の正本は Spec 側にあり、この面は
            値を持たない (見本が正本になると二重管理になるため)。
          </p>
          <div className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
            <p className="font-medium">決まったこと (2026-08-16)</p>
            <ul className="mt-2 flex flex-col gap-2 text-muted-foreground">
              <li>
                速さは <span className="font-mono text-xs">150 / 300 / 500ms</span>{" "}
                の静かなトーン。上のトグルの既定 (M) が本番の登場速度で、退出は
                その1段下。
              </li>
              <li>
                拡大ズームは不採用。ダイアログもメニューも「フェード + 8px の上昇」
                だけで開く。跳ね返り (バネ) も使わない。
              </li>
              <li>
                実装は @theme の一括上書き。外部パッケージは足さず、動いていなかった
                開閉クラス184箇所に roji トークンで実体を与えた。
              </li>
            </ul>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            動きを減らす設定 (OS の「視差効果を減らす」/{" "}
            <span className="font-mono text-xs">prefers-reduced-motion</span>)
            が入っている端末では、移動と拡大の距離が 0
            になり不透明度の変化だけが残る。動きを全部止めないのは、出入りが
            まったく読み取れなくなるのを避けるため。
          </p>
        </section>

        <div className="flex flex-col gap-12">
          <h2 className="text-xl">動きの型</h2>

          {/* ── fade + rise / recede ─────────────────────────────────────── */}
          <Sample
            title="モーダル"
            kind="fade (背後の面) + rise (本体) / recede (退出)"
            note="背後の面は位置を持たないので動かさない。本体だけが下から静かに立ち上がり、閉じるときは半分の距離で引く。"
            tokens={[
              "--animate-fade",
              "--animate-rise",
              "--animate-recede",
              "--motion-easing-ease-out",
              "--motion-easing-ease-in",
            ]}
            controls={
              <>
                <Button type="button" size="sm" onClick={modal.play}>
                  再生
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={modal.dismiss}
                  disabled={!modal.visible || modal.closing}
                >
                  しまう
                </Button>
              </>
            }
          >
            <StageBackdrop label="記事ページ" />
            {modal.visible && (
              <>
                <Scrim
                  key={`modal-scrim-${modal.runId}`}
                  closing={modal.closing}
                  onAnimationEnd={modal.onAnimationEnd}
                />
                {/* 位置決め (translate) と動き (animation) は別の要素に分ける。
                    同じ要素に置くと animation の transform が後勝ちして、
                    中央寄せが効かなくなる。 */}
                <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2">
                  <div
                    key={`modal-body-${modal.runId}`}
                    className={cn(
                      "rounded-lg border border-border bg-background p-5 shadow-lg",
                      modal.closing ? "animate-recede" : "animate-rise",
                    )}
                  >
                    <p className="text-base font-medium">このお茶を保存する</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      あとで読むリストに入れます。
                    </p>
                  </div>
                </div>
              </>
            )}
          </Sample>

          {/* ── rise / recede (下部バー) ─────────────────────────────────── */}
          <Sample
            title="下部の常駐バー"
            kind="rise / recede"
            note="画面の端に出入りする唯一の部品。今は突然現れて突然消えるので、いちばん差が分かりやすい。"
            tokens={[
              "--animate-rise",
              "--animate-recede",
              "--motion-duration-normal",
              "--motion-duration-fast",
            ]}
            controls={
              <>
                <Button type="button" size="sm" onClick={bar.play}>
                  再生
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={bar.dismiss}
                  disabled={!bar.visible || bar.closing}
                >
                  しまう
                </Button>
              </>
            }
          >
            <StageBackdrop label="記事ページ" />
            {bar.visible && (
              <div className="absolute inset-x-0 bottom-0 z-20">
                <div
                  key={`bar-${bar.runId}`}
                  className={cn(
                    "flex h-16 items-center gap-3 border-t border-border bg-background px-4",
                    bar.closing ? "animate-recede" : "animate-rise",
                  )}
                  onAnimationEnd={bar.onAnimationEnd}
                >
                  <span className="size-8 shrink-0 rounded-full bg-muted" />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm">音声で聴く</span>
                    <span className="text-xs text-muted-foreground">
                      いま流れているもの
                    </span>
                  </span>
                </div>
              </div>
            )}
          </Sample>

          {/* ── expand / collapse ────────────────────────────────────────── */}
          <Sample
            title="メニューの展開"
            kind="expand / collapse"
            note="その場で高さが開く。移動ではなく面積が変わるので、transform ではなく grid の行の高さを動かしている (型の中で唯一の例外)。"
            tokens={[
              "--animate-expand",
              "--animate-collapse",
              "--motion-duration-normal",
            ]}
            controls={
              <>
                <Button type="button" size="sm" onClick={menu.play}>
                  再生
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={menu.dismiss}
                  disabled={!menu.visible || menu.closing}
                >
                  たたむ
                </Button>
              </>
            }
          >
            <div className="flex h-full flex-col gap-3 p-5">
              <p className="text-sm font-medium">お茶を選ぶ</p>
              {menu.visible && (
                <div
                  key={`menu-${menu.runId}`}
                  className={cn(
                    "grid",
                    menu.closing ? "animate-collapse" : "animate-expand",
                  )}
                  onAnimationEnd={menu.onAnimationEnd}
                >
                  {/* 中身のはみ出しを切る内側の層。expand はこの2層で書く。 */}
                  <div className="overflow-hidden">
                    <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                      <li>煎茶</li>
                      <li>ほうじ茶</li>
                      <li>玉露</li>
                      <li>和紅茶</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </Sample>

          {/* ── sheet ────────────────────────────────────────────────────── */}
          <Sample
            title="ドロワー"
            kind="sheet"
            note="画面の外から入ってくることを明示する型。移動距離が唯一 8px を超える (画面外が起点のため)。"
            tokens={[
              "--animate-sheet-in",
              "--animate-sheet-out",
              "--motion-sheet-x",
              "--animate-fade",
            ]}
            controls={
              <>
                <Button type="button" size="sm" onClick={drawer.play}>
                  再生
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={drawer.dismiss}
                  disabled={!drawer.visible || drawer.closing}
                >
                  しまう
                </Button>
              </>
            }
          >
            <StageBackdrop label="商品一覧" />
            {drawer.visible && (
              <>
                <Scrim key={`drawer-scrim-${drawer.runId}`} closing={drawer.closing} />
                <div className="absolute inset-y-0 right-0 z-20 w-2/3">
                  <div
                    key={`drawer-body-${drawer.runId}`}
                    className={cn(
                      "h-full border-l border-border bg-background p-5",
                      drawer.closing ? "animate-sheet-out" : "animate-sheet-in",
                    )}
                    onAnimationEnd={drawer.onAnimationEnd}
                  >
                    <p className="text-base font-medium">絞り込む</p>
                    <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
                      <li>産地</li>
                      <li>品種</li>
                      <li>収穫の時期</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </Sample>

          {/* ── トースト ─────────────────────────────────────────────────── */}
          <Sample
            title="トースト"
            kind="fade + rise (短命)"
            note="数秒で自ら消えるので、再生すると勝手に退出まで見られる。上のトグルで速さを変えると、消え際の印象がいちばん変わる。"
            tokens={["--animate-rise", "--animate-recede", "--motion-duration-fast"]}
            controls={
              <Button type="button" size="sm" onClick={playToast}>
                再生
              </Button>
            }
          >
            <StageBackdrop label="カート" />
            {toast.visible && (
              <div className="absolute inset-x-5 bottom-5 z-20">
                <div
                  key={`toast-${toast.runId}`}
                  className={cn(
                    "rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg",
                    toast.closing ? "animate-recede" : "animate-rise",
                  )}
                  onAnimationEnd={toast.onAnimationEnd}
                >
                  カートに入れました
                </div>
              </div>
            )}
          </Sample>

          {/* ── ホバー ───────────────────────────────────────────────────── */}
          <Sample
            title="ホバー"
            kind="型ではなく既定の transition"
            note="ホバーは常に S 固定 (上のトグルの対象外)。左が今の書き方、右が置き換え前の直書き。狙いは見た目を変えることではなく、70ファイルに散った値をトークン1本に寄せること。"
            tokens={[
              "duration-fast (= --motion-duration-fast)",
              "ease-enter (= --motion-easing-ease-out)",
            ]}
            controls={
              <p className="text-xs text-muted-foreground">
                ボタンはありません。下の2枚にカーソルを乗せて見比べてください。
              </p>
            }
          >
            <div className="grid h-full grid-cols-2 gap-4 p-5">
              <div className="flex flex-col gap-2">
                <p className="font-mono text-xs text-muted-foreground">
                  duration-fast / ease-enter
                </p>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-border bg-card text-sm transition-colors duration-fast ease-enter hover:bg-muted"
                >
                  配線後
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-mono text-xs text-muted-foreground">
                  duration-200 (旧・直書き 38箇所)
                </p>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-border bg-card text-sm transition-colors duration-200 hover:bg-muted"
                >
                  置き換え前
                </button>
              </div>
            </div>
          </Sample>
        </div>

        {/* ── D-2 比較 ─────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl">拡大ズーム — あり / なし (判断の記録)</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            同じモーダルを、左は「上に 8px 動くだけ」、右は「95% から原寸へ拡大」で
            開く。左を採用し、右は本番では使わない (この比較欄にだけ残している)。
            速さのトグルはこちらにも効く。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={zoomCompare.play}>
              同時に再生
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={zoomCompare.dismiss}
              disabled={!zoomCompare.visible || zoomCompare.closing}
            >
              しまう
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                {
                  id: "rise",
                  heading: "案A — 拡大なし (採用)",
                  body: "fade + rise",
                  enterClass: "animate-rise",
                  tokens: ["--animate-rise", "--motion-rise-distance"],
                },
                {
                  id: "zoom",
                  heading: "案B — 拡大あり (不採用)",
                  body: "fade + zoom (95% → 100%)",
                  enterClass: "animate-zoom",
                  tokens: ["--animate-zoom", "--motion-zoom-from"],
                },
              ] as const
            ).map((variant) => (
              <div key={variant.id} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-medium">{variant.heading}</h3>
                  <p className="font-mono text-xs text-muted-foreground">
                    {variant.body}
                  </p>
                </div>
                <div className="relative isolate h-56 w-full overflow-hidden rounded-lg border border-border bg-card">
                  <StageBackdrop label="商品ページ" />
                  {zoomCompare.visible && (
                    <>
                      <Scrim
                        key={`${variant.id}-scrim-${zoomCompare.runId}`}
                        closing={zoomCompare.closing}
                        onAnimationEnd={
                          // 退出の完了判定は左だけで取る (2枚とも同じ長さなので
                          // どちらか一方で足りる。両方に付けると二重に発火する)。
                          variant.id === "rise"
                            ? zoomCompare.onAnimationEnd
                            : undefined
                        }
                      />
                      <div className="absolute inset-x-5 top-1/2 z-20 -translate-y-1/2">
                        <div
                          key={`${variant.id}-body-${zoomCompare.runId}`}
                          className={cn(
                            "rounded-lg border border-border bg-background p-5 shadow-lg",
                            zoomCompare.closing
                              ? "animate-recede"
                              : variant.enterClass,
                          )}
                        >
                          <p className="text-base font-medium">かごに入れる</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            数量を選んでください。
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <TokenList items={variant.tokens} />
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2 className="text-xl">どこまで入っているか</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            定義はすべて{" "}
            <span className="font-mono text-xs">app/globals.css</span>{" "}
            のモーション節にある。Tailwind の既定の時間とカーブをトークンに
            差し替えたので、<span className="font-mono text-xs">transition-colors</span>{" "}
            とだけ書いてある約70ファイルは無編集で乗り換わっている。動いていなかった
            開閉クラス184箇所にも実体を与えたので、モーダル・メニュー・ドロワー・
            アコーディオンが実際に動く。音声バーと全画面パネル、Cookie
            バーの出入りもこの語彙で書き直した。
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            触っていないのはトースト (sonner) の出入りと、ページ遷移・スクロール
            登場。前者はライブラリ同梱の動きで既に成立しており、後者は実装ゼロからの
            新規追加になるため別で判断する。
          </p>
        </section>
      </div>
    </main>
  );
}
