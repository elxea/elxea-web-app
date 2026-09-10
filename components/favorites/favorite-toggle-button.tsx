"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Bookmark, Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { trackFavoriteAdd } from "@/lib/firebase/behavior-tracker";
import type { FavoriteKind } from "@/lib/account-favorites";
import {
  ensureFavoritesHydrated,
  getFavoritesServerSnapshot,
  getFavoritesSnapshot,
  isFavoritesAuthed,
  readFavoriteState,
  subscribeToFavorites,
  toggleFavorite,
} from "@/lib/favorites/client-store";
import { cn } from "@/lib/utils";

/**
 * FavoriteToggleButton — 「保存する / 保存済み」のトグル。**種類も見た目も引数**。
 *
 * ## 4 つあった実装を 1 つにした (D-12 / 再設計 M-7)
 *
 * 商品 (`product/favorite-button.tsx`)・読みもの (`journal/bookmark-button.tsx`)・
 * 人 (ここ)・農家 (`farmers/follow-button.tsx`) が、**同じ API を叩く同じ動き**を
 * 4 通りに書いていた。だから片方に入った直しがもう片方に無い状態が常態化していた
 * (記事側には未ログイン・状態不明・遅れて届いた応答の扱いがあったが、商品側は
 * `catch {}` で握り潰したまま)。ログイン判定の 1 行も 4 か所に複製されていて、
 * セッションの扱いが変わると 4 か所が同時に壊れた。
 *
 * 見た目は 3 つとも Figma の既存のものをそのまま `appearance` で選ぶ。
 * **新しい見た目は作っていない**。
 *
 * ## 「確認しています」をやめた (Setaka 実機指摘 2026-08-25)
 *
 * 以前はマウントのたびに 1 個ずつ `?check=` を叩き、その往復が終わるまで
 * 「ブックマークの状態を確認しています」という**別の文言**を出していた。文字幅が
 * 変わるのでその場のレイアウトが動き、押しても反応が無いように見えた。
 *
 * いまは登録状態を `lib/favorites/client-store.ts` が**タブに 1 つ**持つ。
 *   - ページを移っても取り直さない (遷移直後の 1 枚目から確定している)
 *   - マイページのようにサーバが一覧を知っている画面では往復ゼロ (`seed`)
 *   - ボタンは倉庫を読むだけなので、**途中の文言も途中の見た目も存在しない**
 *
 * まだ読めていない / 読めなかったときは、**素の「保存する」の見た目のまま**にする
 * (文字も幅も変えない)。代わりに `aria-pressed` を名乗らず、押されたときは
 * **書き込む前に 1 件だけ実体を確かめてから**反転する。見た目を待たせない代わりに、
 * 書き込みの向きだけは絶対に取り違えない、という取り決め。
 *
 * ## targetId について
 *
 * Firestore の favorites は `targetId = slug / handle` で書かれている。locale を
 * 混ぜた複合キー (`ja:slug` 等) には変更しない — 変えると既存ユーザーの登録が全件
 * 「未登録」に見える。ja/en が同一 slug を共有する点は既知の割り切り。
 */

export type FavoriteToggleLabels = {
  /** 未登録のときのラベル (例「保存する」)。 */
  add: string;
  /** 登録済みのときに `title` に出す説明 (押すと外れる、が伝わる文言)。 */
  remove: string;
  /** 登録済みのときに画面に出す状態ラベル (例「保存済み」)。 */
  saved: string;
  /** 登録できたときのトースト。 */
  added: string;
  /** 解除できたときのトースト。 */
  removed: string;
  /** 失敗したときのトースト。 */
  error: string;
  /** 未ログインで押されたときのトースト。 */
  loginRequiredMessage: string;
};

/**
 * 見た目。**既存の 3 通りをそのまま選ぶだけ**で、新しい造作は増やさない。
 *
 *   - `panel`   … 読みもの / 人。高さ 44 の罫線つきボタン + しおりアイコン
 *                 (Figma `BookmarkButton (Module)` 8171:299)
 *   - `product` … 商品ページの購入カラム。outline の小ボタン + ハート
 *   - `icon`    … アイコンだけの小さいボタン (一覧カードなど)
 */
export type FavoriteToggleAppearance = "panel" | "product" | "icon";

export type FavoriteToggleButtonProps = {
  /** お気に入りの種類。`FAVORITE_KINDS` の語。 */
  kind: FavoriteKind;
  /** Firestore に入る識別子 (商品 handle / 記事 slug / 人 slug)。 */
  targetId: string;
  /** マイページに出す見出し (再取得せずに描くために保存する)。 */
  title: string;
  /**
   * マイページに出す画像。**絶対 URL か null**。
   *
   * API 側の受け口が `z.string().url()` なので、相対パスを渡すと 400 になる。
   * 呼び出し側で絶対 URL に解決できないときは null を渡すこと。
   */
  imageUrl: string | null;
  labels: FavoriteToggleLabels;
  appearance?: FavoriteToggleAppearance;
  className?: string;
};

export function FavoriteToggleButton({
  kind,
  targetId,
  title,
  imageUrl,
  labels,
  appearance = "panel",
  className,
}: FavoriteToggleButtonProps) {
  const snapshot = useSyncExternalStore(
    subscribeToFavorites,
    getFavoritesSnapshot,
    getFavoritesServerSnapshot,
  );
  const [isPending, setIsPending] = useState(false);

  /* 倉庫の取り込みは 1 タブ 1 回。何個ボタンが載っていても往復は増えない
     (2 個目以降の `ensureFavoritesHydrated()` は何もしない)。 */
  useEffect(() => {
    ensureFavoritesHydrated();
  }, []);

  const state = readFavoriteState(snapshot, kind, targetId);
  const isSaved = state === "saved";

  const onClick = useCallback(async () => {
    if (isPending) return;
    if (!isFavoritesAuthed()) {
      toast(labels.loginRequiredMessage);
      return;
    }

    setIsPending(true);
    try {
      const outcome = await toggleFavorite({ kind, targetId, title, imageUrl });
      if (outcome === "added") {
        toast(labels.added);
        trackFavoriteAdd({ contentId: targetId, type: kind });
      } else if (outcome === "removed") {
        toast(labels.removed);
      } else if (outcome === "unauthenticated") {
        toast(labels.loginRequiredMessage);
      } else {
        toast.error(labels.error);
      }
    } finally {
      setIsPending(false);
    }
  }, [isPending, kind, targetId, title, imageUrl, labels]);

  /* 見えている文字がそのままアクセシブル名になる (aria-label で別の文字列を
     被せない)。アイコンは `aria-hidden`。 */
  const label = isSaved ? labels.saved : labels.add;

  /**
   * 進行の印を出してよいのは、**まだ状態が分かっていないとき**だけ
   * (Setaka 実機指摘 2026-08-26)。
   *
   * 倉庫 (`client-store`) は押した瞬間に書き換わるので、`state` が分かっている
   * 場合はその時点で「保存済み」が正しい。それなのに以前はアイコンを往復のあいだ
   * ずっと `Loader2` に差し替えていたので、**文字は「保存済み」なのに絵は
   * 「処理中」**という食い違った知らせを出していた。しかも `disabled` で
   * 押し直せなかった。
   *
   * `unknown` (一覧がまだ着いていない / 読めなかった) のときだけは、反転の向きを
   * 確かめる 1 往復 (実測 335-393ms) を挟むので**本当に何も確定していない**。
   * 進行の印が要るのはそこだけ。
   */
  const showProgress = isPending && state === "unknown";

  const common = {
    onClick,
    /* **押せなくしない**。二重送信は `onClick` 冒頭の再入ガードが受け持つので、
       見た目まで殺す必要がない (殺すと「壊れている」ようにしか見えない)。 */
    "aria-busy": isPending,
    /* 状態が分かっていないときは pressed を名乗らない (未登録と断定できないため)。 */
    "aria-pressed": state === "unknown" ? undefined : isSaved,
    title: isSaved ? labels.remove : label,
    "data-slot": "favorite-toggle",
    "data-kind": kind,
    "data-state": isSaved ? "active" : state === "unknown" ? "unknown" : "default",
  } as const;

  if (appearance === "product") {
    return (
      <Button {...common} variant="outline" size="sm" className={cn("gap-2", className)}>
        {showProgress ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Heart
            aria-hidden="true"
            className={cn(
              "size-4 transition-colors duration-fast",
              isSaved ? "fill-destructive text-destructive" : "fill-none text-current",
            )}
          />
        )}
        {label}
      </Button>
    );
  }

  if (appearance === "icon") {
    return (
      <Button
        {...common}
        variant="ghost"
        size="icon"
        aria-label={label}
        className={cn("transition-colors duration-fast", className)}
      >
        {showProgress ? (
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        ) : (
          <Heart
            aria-hidden="true"
            className={cn(
              "size-5 transition-colors duration-fast",
              isSaved
                ? "fill-destructive text-destructive"
                : "fill-none text-muted-foreground",
            )}
          />
        )}
      </Button>
    );
  }

  return (
    <Button
      {...common}
      variant="ghost"
      className={cn(
        // Figma 実測: 高さ 44 (タップ最小域) / padding 16x12 / gap 8 /
        // 角丸 radius-md / 1px 罫線 / 文字 body-sm。
        "h-11 gap-2 rounded-md border px-4 py-3 text-sm font-normal",
        "transition-colors duration-fast",
        isSaved
          ? "border-foreground bg-secondary text-foreground hover:bg-secondary"
          : "border-border bg-card text-foreground hover:bg-muted",
        className,
      )}
    >
      {showProgress ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      ) : (
        <Bookmark
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-colors duration-fast",
            isSaved ? "fill-current" : "fill-none",
          )}
        />
      )}
      {label}
    </Button>
  );
}
