"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { trackFavoriteAdd } from "@/lib/firebase/behavior-tracker";
import type { FavoriteKind } from "@/lib/account-favorites";
import { cn } from "@/lib/utils";

/**
 * FavoriteToggleButton — 「保存する / 保存済み」のトグル。**種類を問わない**。
 *
 * ## なぜ種類を問わない部品を足したのか
 *
 * 記事の保存 (`components/journal/bookmark-button.tsx`) と商品の保存
 * (`components/product/favorite-button.tsx`) は、同じ `/api/user/favorites` を
 * 叩く同じ動きなのに実装が別々で、片方だけに入った直しがもう片方に無い状態が
 * 続いていた (記事側には未ログイン・状態不明・遅れて届いた応答の扱いがあるが、
 * 商品側は `catch {}` で握り潰したまま)。人 (`/people/[slug]`) を 3 つ目の種類として
 * 足すにあたり、3 つ目の実装を増やさずに **種類を引数にした 1 本** をここに置く。
 *
 * 記事・商品の 2 つをこの部品へ寄せる差し替えは本タスクの範囲外 (`bookmark-button.tsx`
 * は並行タスクが編集中のため触らない)。寄せるときは props を渡し替えるだけで済む。
 *
 * ## 状態の持ち方 (記事の保存ボタンで確立した設計をそのまま引き継ぐ)
 *
 * - `authState`  unknown  … SSR / マウント直後。cookie はクライアントでしか読めない
 *                            ので、ここで確定した見た目を出さない。
 *   　　　　　　　anonymous … 未ログイン。押すとログインを促す (無効化しない —
 *                            「押せないボタン」より「押すと理由が出る」方が伝わる)。
 *   　　　　　　　authed    … ログイン済み。
 * - `checkState` checking … 登録状態の問い合わせ中 → `aria-busy` (無効化はしない)。
 *   　　　　　　　ok       … 取得できた (`isSaved` が信用できる)。
 *   　　　　　　　error    … 取得できなかった。空アイコンで「未登録」を騙らず、
 *                            エラー色 + 押下で再確認にする (握り潰さない)。
 *
 * 更新は楽観更新 + 失敗時ロールバック。押した瞬間に見た目を反転させ、サーバが
 * 失敗を返したら元に戻して理由をトーストで出す。
 *
 * 無効化するのは書き込み中 (`isPending`) だけ。確認の往復 (数百 ms〜数秒) を
 * 待たせる理由が無いので、確認が終わる前に押されたら押下時に確認 → 実行へ倒す。
 *
 * `writeEpochRef` は「書き込みが何回始まったか」の通し番号 (単調増加・巻き戻さない)。
 * 真偽値だと「書き込みが終わった**後**に届いた古い確認応答」を止められず、確定した
 * 保存が巻き戻る。番号なら、確認を投げた時点と着地時点を比べるだけで「その間に
 * 書き込みが挟まったか」が判り、挟まっていればその答え (= 書き込み前の世界) を捨てられる。
 *
 * ## targetId について
 *
 * Firestore の favorites は `targetId = slug / handle` で書かれている。locale を
 * 混ぜた複合キー (`ja:slug` 等) には変更しない — 変えると既存ユーザーの登録が全件
 * 「未登録」に見える。ja/en が同一 slug を共有する点は既知の割り切り。
 */

type AuthState = "unknown" | "anonymous" | "authed";
type CheckState = "checking" | "ok" | "error";

export type FavoriteToggleLabels = {
  /** 未登録のときのラベル (例「保存する」)。 */
  add: string;
  /** 登録済みのときに `title` に出す説明 (押すと外れる、が伝わる文言)。 */
  remove: string;
  /** 登録済みのときに画面に出す状態ラベル (例「保存済み」)。 */
  saved: string;
  /**
   * 登録状態を **問い合わせ中** に出すラベル。
   *
   * 「保存中」ではない。まだ何も押していないマウント直後にも出るので、
   * 「保存中…」を渡すと触ってもいないのに保存が走っているように読める。
   */
  loading: string;
  /** 未ログインの人に出すラベル。 */
  loginRequired: string;
  /** 登録状態を取得できなかったときのラベル。 */
  statusUnknown: string;
  /** 登録できたときのトースト。 */
  added: string;
  /** 解除できたときのトースト。 */
  removed: string;
  /** 失敗したときのトースト。 */
  error: string;
  /** 未ログインで押されたときのトースト。 */
  loginRequiredMessage: string;
  /** 状態不明のまま押されて再確認に入るときのトースト。 */
  statusRetry: string;
};

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
  className?: string;
};

/** ログイン判定は cookie のみ (`/api/user/favorites` はメールでも LINE でも通る)。 */
function readAuthState(): AuthState {
  if (typeof document === "undefined") return "unknown";
  return document.cookie.includes("shop_auth=1") || document.cookie.includes("line_auth=1")
    ? "authed"
    : "anonymous";
}

export function FavoriteToggleButton({
  kind,
  targetId,
  title,
  imageUrl,
  labels,
  className,
}: FavoriteToggleButtonProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("unknown");
  const [checkState, setCheckState] = useState<CheckState>("checking");
  /** 再確認のたびに増やす。effect の再実行トリガ兼、古い応答の破棄に使う。 */
  const [checkNonce, setCheckNonce] = useState(0);
  const mountedRef = useRef(true);
  /** 書き込みが何回始まったかの通し番号 (上の注記参照。巻き戻さない)。 */
  const writeEpochRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 登録状態を 1 回問い合わせる。取れなければ `null` (「未登録」と混同しない)。 */
  const fetchSavedState = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch(
        `/api/user/favorites?check=${encodeURIComponent(targetId)}&checkType=${kind}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.favorited === true;
    } catch {
      return null;
    }
  }, [kind, targetId]);

  useEffect(() => {
    let cancelled = false;
    const auth = readAuthState();
    setAuthState(auth);

    // 未ログインは問い合わせるだけ無駄 (401 が返る)。状態は「未確認」ではなく
    // 「ログインしていないので登録なし」で確定させる。
    if (auth !== "authed") {
      setIsSaved(false);
      setCheckState("ok");
      return;
    }

    setCheckState("checking");

    /* この確認が「いつの世界の答えか」を刻む。着地したときに番号が変わっていれば、
       その間に書き込みが挟まった = この答えは書き込み前の状態を指している。 */
    const epoch = writeEpochRef.current;

    (async () => {
      const resolved = await fetchSavedState();
      if (cancelled || writeEpochRef.current !== epoch) return;
      if (resolved === null) {
        setCheckState("error");
        return;
      }
      setIsSaved(resolved);
      setCheckState("ok");
    })();

    return () => {
      cancelled = true;
    };
  }, [checkNonce, fetchSavedState]);

  const toggle = useCallback(async () => {
    if (readAuthState() !== "authed") {
      setAuthState("anonymous");
      toast(labels.loginRequiredMessage);
      return;
    }

    // 状態が取れていないまま反転させると、登録済みのものを再登録する等の
    // 取り違えが起きる。まず状態の再取得からやり直す。
    if (checkState === "error") {
      toast(labels.statusRetry);
      setCheckNonce((n) => n + 1);
      return;
    }

    /* ここから先はこの押下が状態の持ち主。番号を進めた時点で、いま飛んでいる
       確認の応答は (いつ着地しても) すべて期限切れになる。番号は戻さない。 */
    writeEpochRef.current += 1;
    setIsPending(true);

    try {
      let previous = isSaved;

      /* 確認が終わる前に押された場合は、ここで確認してから実行する。
         「確認が終わるまで押せない」で待たせない代わりに、反転の向きだけは
         必ず実体に合わせる。 */
      if (checkState === "checking") {
        const resolved = await fetchSavedState();
        if (resolved === null) {
          if (mountedRef.current) setCheckState("error");
          toast(labels.statusRetry);
          return;
        }
        previous = resolved;
        if (mountedRef.current) {
          setIsSaved(resolved);
          setCheckState("ok");
        }
      }

      const next = !previous;

      // 楽観更新 — 押した瞬間に反映する。
      if (mountedRef.current) setIsSaved(next);

      try {
        const res = next
          ? await fetch("/api/user/favorites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: kind, targetId, title, imageUrl }),
            })
          : await fetch("/api/user/favorites", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: kind, targetId }),
            });

        if (!res.ok) throw new Error(`favorites write failed: ${res.status}`);

        if (next) {
          toast(labels.added);
          trackFavoriteAdd({ contentId: targetId, type: kind });
        } else {
          toast(labels.removed);
        }
      } catch {
        // ロールバック — 失敗したら押す前の状態に戻す (見た目だけ進めない)。
        if (mountedRef.current) setIsSaved(previous);
        toast.error(labels.error);
      }
    } finally {
      // 番号はここで戻さない。戻すと「書き込み後に着地した古い応答」がまた通る。
      if (mountedRef.current) setIsPending(false);
    }
  }, [isSaved, checkState, fetchSavedState, kind, targetId, title, imageUrl, labels]);

  const isResolving = authState === "unknown" || checkState === "checking";
  const isUnknown = checkState === "error";

  /**
   * 記事の保存ボタン (Figma `BookmarkButton (Module)` 8171:299) と同じ 4 状態
   * + `unknown` (登録状態の取得に失敗) に写す。`unknown` は Figma に無いが、
   * 消すと「取得できていないのに未登録の顔をする」に戻るため残す (destructive の
   * 罫線で他の 4 状態と取り違えないようにする)。
   *
   * ラベルは見えている文字列がそのままアクセシブル名になる (aria-label で別の
   * 文字列を被せない)。アイコンは `aria-hidden`。
   */
  const visual = isResolving
    ? "loading"
    : isUnknown
      ? "unknown"
      : authState === "anonymous"
        ? "logged-out"
        : isSaved
          ? "active"
          : "default";

  const label =
    visual === "loading"
      ? labels.loading
      : visual === "unknown"
        ? labels.statusUnknown
        : visual === "logged-out"
          ? labels.loginRequired
          : visual === "active"
            ? labels.saved
            : labels.add;

  return (
    <Button
      variant="ghost"
      onClick={toggle}
      /* 無効化するのは書き込み中だけ (二重送信の防止)。 */
      disabled={isPending}
      aria-busy={isResolving || isPending}
      // 状態不明のときは pressed を騙らない (未登録と断定できないため)。
      aria-pressed={isUnknown ? undefined : isSaved}
      title={visual === "active" ? labels.remove : label}
      data-slot="favorite-toggle"
      data-kind={kind}
      data-state={visual}
      className={cn(
        // Figma 実測: 高さ 44 (タップ最小域) / padding 16x12 / gap 8 /
        // 角丸 radius-md / 1px 罫線 / 文字 body-sm。
        "h-11 gap-2 rounded-md border px-4 py-3 text-sm font-normal",
        "transition-colors duration-fast",
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
