"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * マイページの「LINEとの連携を解除する」導線（新規実装）。
 *
 * ## なぜ今まで無かったのか / なぜ今置けるのか
 *
 * ここには以前「連携済みでも解除の導線は出さない」と明記されていた。理由は、解除が
 * 行削除なのか旗立てなのかという**状態遷移が未確定**で、押せるボタンを先に置くと
 * 定義が実装に引きずられるから。その状態遷移が確定した（連携行は消さず、連携を表す
 * 列だけを空にする＝配信停止などお客さまの設定を巻き戻さない）ので、導線を出せる。
 *
 * ## 押したあと何が起きるか
 *
 * `DELETE /api/user/line-link` が **cx-agent の連携台帳を先に外し、成功したときだけ**
 * Firestore の写しを消す。cx-agent 側が失敗したら非 2xx が返るので、ここでは
 * 成功扱いにせず失敗として出す。**「解除しました」と言って解除できていない**のが
 * この機能で直している当のものなので、楽観的な表示にしない。
 *
 * ## 確認ダイアログで必ず伝えること
 *
 * 解除は取り消しに手間がかかる操作なので、押す前に「何が消えないか」「何が変わるか」を
 * 出す。ここを省くと、お客さまは「連携を切ったら注文履歴も消えるのでは」と怖がって
 * 押せないか、逆に「トークの内容も引き継がれる」と誤解する。
 */

const COPY = {
  ja: {
    trigger: "連携を解除する",
    title: "LINEとの連携を解除しますか",
    /** 何が消えないか。解除 ≠ データ削除であることを最初に言う。 */
    keeps:
      "ご注文の履歴・お届け先・お気に入りは、これまでどおり残ります。解除で消えるものはありません。",
    /** LINE 側で何が起きないか。友だち解除と混同されやすいので明示する。 */
    friendship:
      "LINEの友だち登録はそのままです。解除するのは、このアカウントとLINEの結び付きだけです。",
    /** 解除後の見え方。ここを言わないと「トークの内容が消えた」と受け取られる。 */
    afterwards:
      "解除したあとにLINEでお話しかけいただくと、はじめましての状態から始まります。これまでのやり取りやお好みは残っていますので、もう一度連携していただければ、また同じようにご覧いただけます。",
    /** 配信の扱い。既定は継続（停止したい方はLINEのブロックで止められる）。 */
    delivery:
      "ご注文や発送のお知らせは、これまでどおりLINEにお届けします。お知らせ自体を止めたいときは、LINEでelxeaをブロックしてください。",
    cancel: "やめておく",
    confirm: "連携を解除する",
    pending: "解除しています",
    /** 失敗。原因は詮索させず、もう一度を促す（既存のエラー文言方針と同じ）。 */
    error:
      "連携を解除できませんでした。お手数ですが、時間をおいてもう一度お試しください。",
  },
  en: {
    trigger: "Unlink",
    title: "Unlink your LINE account?",
    keeps:
      "Your order history, shipping addresses, and favourites all stay as they are. Nothing is deleted when you unlink.",
    friendship:
      "You will still be friends with us on LINE. Unlinking only removes the connection between this account and LINE.",
    afterwards:
      "After unlinking, a chat on LINE starts fresh. Your past messages and preferences are kept, so linking again brings them back.",
    delivery:
      "We will keep sending order and shipping updates on LINE. To stop them altogether, block elxea on LINE.",
    cancel: "Keep it linked",
    confirm: "Unlink",
    pending: "Unlinking",
    error: "We could not unlink your account. Please try again in a little while.",
  },
} as const;

type Locale = keyof typeof COPY;

export function LineUnlinkControl({ locale }: { locale: string }) {
  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleConfirm() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/user/line-link", {
        method: "DELETE",
        credentials: "same-origin",
      });

      /* 非 2xx は失敗。cx-agent が外せていない可能性があるので、
         画面だけ「解除済み」にしない（成功偽装をしない）。 */
      if (!res.ok) {
        setFailed(true);
        return;
      }

      setOpen(false);
      /* サーバ側の連携状態を引き直して、この節を「未連携」表示に差し替える。 */
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            data-testid="line-unlink-trigger"
          >
            {t.trigger}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent data-testid="line-unlink-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p data-testid="line-unlink-keeps">{t.keeps}</p>
                <p data-testid="line-unlink-friendship">{t.friendship}</p>
                <p data-testid="line-unlink-afterwards">{t.afterwards}</p>
                <p data-testid="line-unlink-delivery">{t.delivery}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t.cancel}</AlertDialogCancel>
            {/* 既定の閉じる挙動を止める。閉じてから解除するとネットワーク失敗が
                お客さまに見えないまま「解除できた」と受け取られる。 */}
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirm();
              }}
              disabled={pending}
              aria-busy={pending}
              data-testid="line-unlink-confirm"
            >
              {pending ? t.pending : t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {failed ? (
        <p
          className="text-sm text-foreground leading-relaxed"
          role="alert"
          data-testid="line-unlink-error"
        >
          {t.error}
        </p>
      ) : null}
    </div>
  );
}
