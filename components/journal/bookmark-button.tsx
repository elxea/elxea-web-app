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
 * - `checkState` checking … 登録状態の問い合わせ中 → `aria-busy` (無効化はしない)。
 *   　　　　　　　ok       … 取得できた (`isBookmarked` が信用できる)。
 *   　　　　　　　error    … 取得できなかった。空アイコンで「未登録」を騙らず、
 *                            エラー色 + 押下で再確認にする (握り潰さない)。
 *
 * 更新は楽観更新 + 失敗時ロールバック。押した瞬間に見た目を反転させ、
 * サーバが失敗を返したら元に戻して理由をトーストで出す。
 *
 * ## 「確認が終わるまで押せない」にはしない
 *
 * 以前は `checkState === "checking"` の間もボタンを無効化していた。確認は
 * `/api/user/favorites` への往復なので、回線が遅いと記事を開いた直後の数百 ms〜
 * 数秒、押しても何も起きないボタンが出る。しかも見た目が薄くなるだけで理由は
 * 出ないので、お客さまからは「お気に入りが壊れている」としか見えない。
 *
 * よって**無効化するのは書き込み中 (`isPending`) だけ**にし、確認が終わる前に
 * 押された場合は押下時に確認 → 実行へ倒す (`toggleBookmark` 参照)。押下は必ず
 * 受け取り、待たせない。
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
  /** Label text when already bookmarked (押すと外す、という動作の説明。title に出す) */
  removeLabel: string;
  /** 保存済みのときに画面に出す状態ラベル (Figma 8171:299 active = 「保存済み」) */
  savedLabel: string;
  /**
   * Label while the current bookmark state is being fetched.
   *
   * ここは「保存中」ではなく**「登録済みかどうかを確認中」**。まだ何も押していない
   * マウント直後にも出るラベルなので、`bookmarkSaving` (保存中…) を渡すと、
   * 触ってもいないのに保存が走っているように読める。`bookmarkLoading`
   * (ブックマークの状態を確認しています) を渡すこと。
   */
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
  savedLabel,
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
  /**
   * 押下起点の処理が走っている間 true。
   *
   * ボタンを確認中も押せるようにした結果、マウント時の確認とお客さまの押下が
   * 同時に飛びうる。確認の応答が後から届いて楽観更新を上書きすると、押したのに
   * 元に戻ったように見える。押下が始まった時点で「状態の持ち主」は押下側に移り、
   * 飛んでいる確認の応答は捨てる。
   */
  const writeInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 登録状態を 1 回問い合わせる。取れなければ `null` (「未登録」と混同しない)。 */
  const fetchBookmarkState = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch(
        `/api/user/favorites?check=${encodeURIComponent(articleSlug)}&checkType=article`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.favorited === true;
    } catch {
      return null;
    }
  }, [articleSlug]);

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
      const resolved = await fetchBookmarkState();
      // 押下が始まっていたら、こちらの答えはもう古い。押下側に譲る。
      if (cancelled || writeInFlightRef.current) return;
      if (resolved === null) {
        // 握り潰さない — 「未登録」と見分けがつかない空アイコンを出さず、
        // 状態不明であることを UI とラベルに出して再確認できるようにする。
        setCheckState("error");
        return;
      }
      setIsBookmarked(resolved);
      setCheckState("ok");
    })();

    return () => {
      cancelled = true;
    };
  }, [articleSlug, checkNonce, fetchBookmarkState]);

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

    // ここから先はこの押下が状態の持ち主。飛んでいる確認の応答は捨てる。
    writeInFlightRef.current = true;
    setIsPending(true);

    try {
      let previous = isBookmarked;

      /* 確認が終わる前に押された場合は、ここで確認してから実行する。
         「確認が終わるまで押せない」で待たせない代わりに、反転の向きだけは
         必ず実体に合わせる (未確認のまま反転すると、登録済みのものを
         もう一度登録する等の取り違えが起きる)。 */
      if (checkState === "checking") {
        const resolved = await fetchBookmarkState();
        if (resolved === null) {
          // 確認できなかった。未登録を騙らず、状態不明に倒して再確認させる。
          if (mountedRef.current) setCheckState("error");
          toast(statusRetryMessage);
          return;
        }
        previous = resolved;
        if (mountedRef.current) {
          setIsBookmarked(resolved);
          setCheckState("ok");
        }
      }

      const next = !previous;

      // 楽観更新 — 押した瞬間に反映する。
      if (mountedRef.current) setIsBookmarked(next);

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
      }
    } finally {
      writeInFlightRef.current = false;
      if (mountedRef.current) setIsPending(false);
    }
  }, [
    isBookmarked,
    checkState,
    fetchBookmarkState,
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

  /**
   * Figma `BookmarkButton (Module)` 8171:299 の 4 状態へ写す。
   *
   * Figma は default / active / loading / logged-out の 4 つ。Wave 2 で足した
   * `unknown` (登録状態の取得に失敗) は Figma に無いが、これを消すと
   * 「取得できていないのに未登録の顔をする」= A5 で直した不具合に戻るため残す。
   * 見た目は destructive の罫線で 4 状態のどれとも取り違えないようにする
   * (DS 側は次回改訂で 5 つ目の状態として取り込むこと)。
   *
   * ラベルは Figma の文言をそのまま出す。Figma の注記どおり「アイコンは
   * aria-hidden、状態はラベル文字列で読み上げる」ので、見えている文字列が
   * そのままアクセシブル名になる (aria-label で別の文字列を被せない)。
   */
  const visual = isResolving
    ? "loading"
    : isUnknown
      ? "unknown"
      : authState === "anonymous"
        ? "logged-out"
        : isBookmarked
          ? "active"
          : "default";

  const label =
    visual === "loading"
      ? loadingLabel
      : visual === "unknown"
        ? statusUnknownLabel
        : visual === "logged-out"
          ? loginRequiredLabel
          : visual === "active"
            ? savedLabel
            : addLabel;

  return (
    <Button
      variant="ghost"
      onClick={toggleBookmark}
      /* 無効化するのは書き込み中だけ (二重送信の防止)。
         確認中も未ログインも無効化しない — 無効なボタンは理由を伝えられないし、
         確認の往復を待たせる理由も無い (押されたら押下時に確認して実行する)。 */
      disabled={isPending}
      aria-busy={isResolving || isPending}
      // 状態不明のときは pressed を騙らない (未登録と断定できないため)。
      aria-pressed={isUnknown ? undefined : isBookmarked}
      title={visual === "active" ? removeLabel : label}
      data-state={visual}
      className={cn(
        // Figma 実測: 高さ 44 (タップ最小域) / padding 16x12 / gap 8 /
        // 角丸 radius-md / 1px 罫線 / 文字 body-sm。
        "h-11 gap-2 rounded-md border px-4 py-3 text-sm font-normal",
        "transition-colors duration-fast",
        // 4 状態 (+ unknown) の面と罫線。
        visual === "active"
          ? "border-foreground bg-secondary text-foreground hover:bg-secondary"
          : visual === "loading"
            ? "border-border bg-card text-muted-foreground opacity-70"
            : visual === "logged-out"
              ? "border-input bg-card text-muted-foreground hover:bg-muted"
              : visual === "unknown"
                ? "border-destructive bg-card text-destructive hover:bg-muted"
                : "border-border bg-card text-foreground hover:bg-muted",
        className
      )}
    >
      <Bookmark
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 transition-colors duration-fast",
          visual === "active" ? "fill-current" : "fill-none",
          visual === "loading" && "animate-pulse"
        )}
      />
      {label}
    </Button>
  );
}
