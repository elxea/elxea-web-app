"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trackFavoriteAdd } from "@/lib/firebase/behavior-tracker";

/**
 * BookmarkButton — 記事のブックマーク。
 *
 * A5 (状態整理): 以前は「未ログイン」「状態を確認中」「確認に失敗」がすべて
 * 同じ半透明の空アイコンで、しかも確認 API の失敗は `catch {}` で握り潰していた。
 * 結果として「登録済みなのに空アイコン」が黙って出て、押すと登録済みのものを
 * もう一度登録しにいく (= 見た目と実体がずれる) 状態だった。
 *
 * ここでは 2 つの状態を独立に持ち、UI でも区別する:
 *
 * - `authState`  unknown  … SSR / マウント直後。cookie はクライアントでしか
 *                            読めないので、ここで確定した見た目を出さない。
 *   　　　　　　　anonymous … 未ログイン。押すとログインを促す (無効化しない —
 *                            「押せないボタン」より「押すと理由が出る」方が伝わる)。
 *   　　　　　　　authed    … ログイン済み。
 * - `checkState` checking … 登録状態の問い合わせ中 → `aria-busy` + 無効化。
 *   　　　　　　　ok       … 取得できた (`isBookmarked` が信用できる)。
 *   　　　　　　　error    … 取得できなかった。空アイコンで「未登録」を騙らず、
 *                            エラー色 + 押下で再確認にする (握り潰さない)。
 *
 * 更新は楽観更新 + 失敗時ロールバック。押した瞬間に見た目を反転させ、
 * サーバが失敗を返したら元に戻して理由をトーストで出す。
 *
 * targetId について: Firestore の favorites は `targetId = 記事 slug` で
 * 既に書かれているため、locale を混ぜた複合キー (`ja:slug` 等) には変更しない。
 * 変更すると既存ユーザーの登録済みブックマークが全件「未登録」に見える
 * (既存データ互換を優先。ja/en の記事が同一 slug を持つ場合に相互に効いて
 * しまう点は既知の割り切りで、移行が必要になった時点で読み取り側に
 * 「新キー → 旧キー」のフォールバックを入れてから切り替える)。
 */

type AuthState = "unknown" | "anonymous" | "authed";
type CheckState = "checking" | "ok" | "error";

type BookmarkButtonProps = {
  /** Sanity article slug — used as targetId in Firestore */
  articleSlug: string;
  /** Article title — stored for display in my-page */
  articleTitle: string;
  /** Article image URL — stored for quick display */
  articleImageUrl: string | null;
  /** Label text for screen readers */
  addLabel: string;
  /** Label text when already bookmarked */
  removeLabel: string;
  /** Label while the current bookmark state is being fetched */
  loadingLabel: string;
  /** Label shown to signed-out visitors */
  loginRequiredLabel: string;
  /** Label when the bookmark state could not be fetched */
  statusUnknownLabel: string;
  /** Toast message on add */
  addedMessage: string;
  /** Toast message on remove */
  removedMessage: string;
  /** Error toast message */
  errorMessage: string;
  /** Login required toast message */
  loginRequiredMessage: string;
  /** Toast message shown when re-checking after a failed status fetch */
  statusRetryMessage: string;
  /** Optional className */
  className?: string;
};

/** ログイン判定は cookie のみ (Phase 1/2: `/api/user/favorites` は LINE も通る)。 */
function readAuthState(): AuthState {
  if (typeof document === "undefined") return "unknown";
  return document.cookie.includes("shop_auth=1") || document.cookie.includes("line_auth=1")
    ? "authed"
    : "anonymous";
}

export function BookmarkButton({
  articleSlug,
  articleTitle,
  articleImageUrl,
  addLabel,
  removeLabel,
  loadingLabel,
  loginRequiredLabel,
  statusUnknownLabel,
  addedMessage,
  removedMessage,
  errorMessage,
  loginRequiredMessage,
  statusRetryMessage,
  className,
}: BookmarkButtonProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("unknown");
  const [checkState, setCheckState] = useState<CheckState>("checking");
  /** 再確認のたびに増やす。effect の再実行トリガ兼、古い応答の破棄に使う。 */
  const [checkNonce, setCheckNonce] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const auth = readAuthState();
    setAuthState(auth);

    // 未ログインは問い合わせるだけ無駄 (401 が返る)。状態は「未確認」ではなく
    // 「ログインしていないので登録なし」で確定させる。
    if (auth !== "authed") {
      setIsBookmarked(false);
      setCheckState("ok");
      return;
    }

    setCheckState("checking");

    (async () => {
      try {
        const res = await fetch(
          `/api/user/favorites?check=${encodeURIComponent(articleSlug)}&checkType=article`
        );
        if (!res.ok) throw new Error(`favorites check failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setIsBookmarked(data.favorited === true);
        setCheckState("ok");
      } catch {
        // 握り潰さない — 「未登録」と見分けがつかない空アイコンを出さず、
        // 状態不明であることを UI とラベルに出して再確認できるようにする。
        if (cancelled) return;
        setCheckState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleSlug, checkNonce]);

  const toggleBookmark = useCallback(async () => {
    if (readAuthState() !== "authed") {
      setAuthState("anonymous");
      toast(loginRequiredMessage);
      return;
    }

    // 状態が取れていないまま反転させると、登録済みのものを再登録する等の
    // 取り違えが起きる。まず状態の再取得からやり直す。
    if (checkState === "error") {
      toast(statusRetryMessage);
      setCheckNonce((n) => n + 1);
      return;
    }

    const previous = isBookmarked;
    const next = !previous;

    // 楽観更新 — 押した瞬間に反映する。
    setIsBookmarked(next);
    setIsPending(true);

    try {
      const res = next
        ? await fetch("/api/user/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "article",
              targetId: articleSlug,
              title: articleTitle,
              imageUrl: articleImageUrl,
            }),
          })
        : await fetch("/api/user/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "article", targetId: articleSlug }),
          });

      if (!res.ok) throw new Error(`favorites write failed: ${res.status}`);

      if (next) {
        toast(addedMessage);
        trackFavoriteAdd({ contentId: articleSlug, type: "article" });
      } else {
        toast(removedMessage);
      }
    } catch {
      // ロールバック — 失敗したら押す前の状態に戻す (見た目だけ進めない)。
      if (mountedRef.current) setIsBookmarked(previous);
      toast.error(errorMessage);
    } finally {
      if (mountedRef.current) setIsPending(false);
    }
  }, [
    isBookmarked,
    checkState,
    articleSlug,
    articleTitle,
    articleImageUrl,
    addedMessage,
    removedMessage,
    errorMessage,
    loginRequiredMessage,
    statusRetryMessage,
  ]);

  const isResolving = authState === "unknown" || checkState === "checking";
  const isUnknown = checkState === "error";

  const label = isResolving
    ? loadingLabel
    : isUnknown
      ? statusUnknownLabel
      : authState === "anonymous"
        ? loginRequiredLabel
        : isBookmarked
          ? removeLabel
          : addLabel;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleBookmark}
      // 解決中だけ無効化する。未ログインは「押すと理由が出る」ほうが伝わるので
      // 無効化しない (無効なボタンは理由を伝えられない)。
      disabled={isResolving}
      aria-busy={isResolving || isPending}
      aria-label={label}
      title={label}
      // 状態不明のときは pressed を騙らない (未登録と断定できないため)。
      aria-pressed={isUnknown ? undefined : isBookmarked}
      data-state={isResolving ? "loading" : isUnknown ? "unknown" : authState}
      className={cn("transition-colors duration-200", className)}
    >
      {isResolving ? (
        // 読み込み中はスケルトン (skeleton プリミティブと同じ見え方)。
        <span
          data-slot="bookmark-skeleton"
          aria-hidden="true"
          className="size-5 animate-pulse rounded-md bg-muted"
        />
      ) : (
        <Bookmark
          aria-hidden="true"
          className={cn(
            "size-5 transition-colors duration-200",
            isUnknown
              ? "fill-none text-destructive"
              : authState === "anonymous"
                ? "fill-none text-muted-foreground/60"
                : isBookmarked
                  ? "fill-foreground text-foreground"
                  : "fill-none text-muted-foreground"
          )}
        />
      )}
    </Button>
  );
}
