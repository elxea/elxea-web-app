"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
 *
 * ## 「残る」だけでは足りない — **どこに**残るのかを言う（2026-08-24）
 *
 * 当初ここは「これまでどおり残ります」とだけ書いていた。**場所を言っていない**ので、
 * LINE でログインしている人がこのダイアログを読むと「解除しても LINE から今までどおり
 * 見える」と受け取れる。実際の挙動はその逆で、解除すると LINE から見える棚は空になり、
 * 中身はメールでログインするアカウント側に丸ごと残る。読み手が LINE 経路か メール経路か
 * でダイアログは変わらないので、**場所を書かない限り片方には必ず嘘に読める**。
 *
 * 挙動の正本は `__tests__/link-unlink-data-lifecycle.test.ts`（推測ではなく、そこで
 * 固定されている 3 点をそのまま日本語にしている）:
 *   - C1 … 連携中に増えたデータは顧客の棚に残り、メールセッションからは解除後も見える
 *   - C2 … 解除すると LINE 側は空になる（按分ではなく、全部メール側に残る）
 *   - D1 … 同じメールアドレスに再連携すると、預けていたデータがそのまま戻る
 *
 * よって文言は「消えません」で止めず、**「メール側に保管される」「LINE からは見えなく
 * なる」「再連携すれば戻る」の 3 点を必ず並べる**。1 つでも欠けると、欠けた側の誤解
 *（消えたと思う / LINE から見えると思う / もう戻らないと思う）がそのまま出る。
 * 上の 3 点は `__tests__/line-unlink-control-copy.test.tsx` で描画から縛ってある。
 */

const COPY = {
  ja: {
    trigger: "連携を解除する",
    title: "LINEとの連携を解除しますか",
    /**
     * 何が消えないか、そして**どこに残るのか**。解除 ≠ データ削除であることを最初に言う。
     * 保管先（メールでログインするアカウント側）まで言い切る（lifecycle C1）。
     */
    keeps:
      "お気に入りやご注文の履歴・お届け先は、メールアドレスでログインするアカウントの側に、そのまま保管されます。解除で消えるものはありません。",
    /** LINE 側で何が起きないか。友だち解除と混同されやすいので明示する。 */
    friendship:
      "LINEの友だち登録はそのままです。解除するのは、このアカウントとLINEの結び付きだけです。",
    /**
     * 解除後の見え方。LINE 側は空に戻る（lifecycle C2）ことと、再連携で戻る
     * （lifecycle D1）ことを対にして言う。片方だけだと必ず誤解される。
     */
    afterwards:
      "解除したあとのLINEは、はじめましての状態に戻ります。お気に入りやこれまでのやり取りはLINEからは見えなくなりますが、なくなったわけではありません。もう一度連携していただければ、いつでも同じようにご覧いただけます。",
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
      "Your favourites, order history, and shipping addresses are kept with the account you sign in to by email. Nothing is deleted when you unlink.",
    friendship:
      "You will still be friends with us on LINE. Unlinking only removes the connection between this account and LINE.",
    afterwards:
      "After unlinking, LINE starts fresh again. Your favourites and past messages are no longer visible from LINE, but they are not gone. Link again any time and they all come back.",
    delivery:
      "We will keep sending order and shipping updates on LINE. To stop them altogether, block elxea on LINE.",
    cancel: "Keep it linked",
    confirm: "Unlink",
    pending: "Unlinking",
    error: "We could not unlink your account. Please try again in a little while.",
  },
} as const;

type Locale = keyof typeof COPY;

/** 未知のロケールは日本語に倒す（本機能の他ページと同じ倒し方）。 */
function copyFor(locale: string) {
  return COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];
}

/**
 * 確認ダイアログの本文（4 段）だけを切り出したもの。
 *
 * Radix の `AlertDialogContent` は**開いていないと DOM に出ない**ので、ダイアログごと
 * 描画するテストは開く操作（＝ブラウザ）を要る。ここで説明文だけを独立した部品に
 * しておくと、node の unit テストから `renderToStaticMarkup` で文面を直接縛れる。
 * 文面は「解除するとデータがどこへ行くか」というお客さまへの約束そのもので、
 * 静かに書き換わってよい場所ではないため、開閉の都合と切り離して固定する。
 *
 * テスト専用の口（`defaultOpen` 等）を `LineUnlinkControl` に足さないのは、本番に
 * 出ない分岐を本番の部品に持たせないため。
 *
 * ## 受け取った props は必ず下ろす（`asChild` の落とし穴）
 *
 * 呼び出し側は `<AlertDialogDescription asChild>` の子としてこれを置く。Radix の Slot は
 * **子の要素に `id` を差し込み、その id を `AlertDialogContent` の `aria-describedby` に
 * 結ぶ**ことで説明文を読み上げに繋いでいる。ここで props を捨てると id が着かず、
 * 「`AlertDialogContent` requires a description」の警告と共に **読み上げから説明文が
 * 丸ごと外れる**（切り出す前は素の `<div>` が子だったので自動的に着いていた）。
 * よって残りの props はそのまま `<div>` に下ろす。
 *
 * `className` だけは `cn()` で**自分で混ぜる**。Slot が混ぜてくれるのは「Slot の
 * className」と「子要素が自分の props として持つ className」で、部品の内側で書いた
 * className はそこに含まれない。素朴に `{...rest}` を後ろに置くと Slot の
 * `text-muted-foreground text-sm` が `space-y-3 text-left` を**上書きして段落間の
 * 余白が消える**（切り出した直後に実際に消え、スクリーンショットで気づいた）。
 */
export function LineUnlinkDialogCopy({
  locale,
  className,
  ...rest
}: { locale: string } & React.ComponentPropsWithoutRef<"div">) {
  const t = copyFor(locale);
  return (
    <div className={cn("space-y-3 text-left", className)} {...rest}>
      <p data-testid="line-unlink-keeps">{t.keeps}</p>
      <p data-testid="line-unlink-friendship">{t.friendship}</p>
      <p data-testid="line-unlink-afterwards">{t.afterwards}</p>
      <p data-testid="line-unlink-delivery">{t.delivery}</p>
    </div>
  );
}

export function LineUnlinkControl({ locale }: { locale: string }) {
  const t = copyFor(locale);
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
              <LineUnlinkDialogCopy locale={locale} />
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
