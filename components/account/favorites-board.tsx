"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  AccountCardGrid,
  AccountExpCard,
  AccountSectionHeader,
  AccountTitleBlock,
} from "@/components/account/account-parts";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  FAVORITE_KIND_META,
  countFavorites,
  indexOfFavorite,
  insertFavoriteIntoGroups,
  removeFavoriteFromGroups,
  type FavoriteEntry,
  type FavoriteGroup,
} from "@/lib/account-favorites";
import { applyLocalFavorite } from "@/lib/favorites/client-store";
import { cn } from "@/lib/utils";

/**
 * お気に入り一覧 (/ja/account/favorites) の本体。
 *
 * ## なぜクライアント側なのか
 *
 * 一覧そのものはサーバで組んで渡す (初期表示にちらつきが無い / ログイン判定が
 * サーバで閉じる)。ここがクライアントなのは **解除操作のため** だけで、押した
 * 瞬間にカードを消し (楽観更新)、API が失敗したら元の位置に戻す。全画面リロードで
 * 消えたか確かめる作りにはしない。
 *
 * ## 件数はすべてこの状態から導く (見出しの合計も含む)
 *
 * 合計件数 (「n件」/「まだありません」) を出す `AccountTitleBlock` も **ここが描く**。
 * 以前はページ (server component) 側が `countFavorites(groups)` をサーバで一度だけ
 * 数えて描いており、解除しても再描画の対象外だった —「カードは消えたのに合計は
 * 3件のまま、リロードで 2件に正る」(F14 / 本番実測 2026-08-25)。件数の出どころが
 * 解除の状態と別の場所にあることが原因なので、**数える対象を state の `groups` 一本に
 * 寄せる**。節見出しの件数 (`group.items.length`) と同じ源になり、楽観更新にも
 * 失敗時の復元にも自動で追従する。ページ側が件数を数え直すと再発するので、
 * ページは `groups` を渡すだけにしてある (`__tests__/account-favorites.test.ts` が縛る)。
 *
 * ## 種類別に出す
 *
 * 節は `FAVORITE_KINDS` の順に固定で並べ、**0 件の種類も枠を残す**。消してしまうと
 * 「商品はお気に入りにできない」と読めてしまう。どんな種類があるか・どの文言キーを
 * 使うかの正本は `lib/account-favorites.ts`。ここは並べるだけなので、種類が増えても
 * このファイルは触らない。
 *
 * 造作はマイページ本体と同じ DS 部品 (`AccountSectionHeader` / `AccountCardGrid` /
 * `AccountExpCard`)。一覧のためだけの新しい見た目は作らない。解除ボタンの体裁は
 * 「フォロー中の農家」の解除と揃える (同じ ghost の小ボタン + 確認トースト)。
 */
export function FavoritesBoard({ groups: initialGroups }: { groups: FavoriteGroup[] }) {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");

  const [groups, setGroups] = useState<FavoriteGroup[]>(initialGroups);
  const [pendingId, setPendingId] = useState<string | null>(null);

  /* 合計は毎描画で state から数え直す (memo しない — 数十件の総和で、
     解除のたびに必ず変わる値なので、覚えておく利点が無い)。 */
  const total = countFavorites(groups);

  async function handleRemove(entry: FavoriteEntry) {
    if (pendingId !== null) return;
    setPendingId(entry.id);

    /* 楽観更新。復元に要るのは「元の添字」だけなので、状態そのもののコピーは
       持たない (連続で解除したとき、古いコピーで全体を巻き戻さないため)。 */
    const originalIndex = indexOfFavorite(groups, entry);
    setGroups((current) => removeFavoriteFromGroups(current, entry.id));
    /* 保存トグルが読む倉庫にも同じことを伝える。伝えないと、ここで外した直後に
       商品ページへ移ったとき「保存済み」のままに見える (事実が 2 か所に割れる)。 */
    applyLocalFavorite(entry.kind, entry.targetId, false);

    try {
      const res = await fetch("/api/user/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: entry.kind, targetId: entry.targetId }),
      });
      if (!res.ok) throw new Error(`Failed to remove favorite (${res.status})`);
      toast(t("removedFromFavorites"));
    } catch {
      setGroups((current) => insertFavoriteIntoGroups(current, entry, originalIndex));
      applyLocalFavorite(entry.kind, entry.targetId, true);
      toast.error(t("actionError"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <AccountTitleBlock
        title={t("favorites")}
        identity={total > 0 ? t("favoritesCount", { count: total }) : t("noFavorites")}
        back={{ label: t("backToAccountLink"), href: "/account" }}
      />

      {groups.map((group) => {
        const meta = FAVORITE_KIND_META[group.kind];
        return (
          <section key={group.kind} data-slot="favorites-group" data-kind={group.kind}>
            <AccountSectionHeader
              title={
                <span className="flex items-baseline gap-3">
                  {t(meta.headingKey)}
                  {group.items.length > 0 ? (
                    /* 件数は見出しの隣に置く。別の行に落とすと、どの節の件数か
                       離れて読めなくなる。 */
                    <span className={cn(captionClass, "text-muted-foreground")}>
                      {t("favoritesCount", { count: group.items.length })}
                    </span>
                  ) : null}
                </span>
              }
              action={
                group.items.length > 0
                  ? undefined
                  : /* 0 件の種類には「探しに行く」導線だけを置く (解除も並べ替えも
                       できることが無いので、節を空のまま終わらせない)。
                       遷移先は `basePath` ではなく `browsePath` — 人のように
                       「詳細ページはあるが一覧ページが無い」種類があり、`basePath`
                       をそのまま押させると 404 に送ってしまう。 */
                    { label: tCommon(meta.browseLabelKey), href: meta.browsePath }
              }
            />

            {group.items.length === 0 ? (
              <div className="page-container pb-2">
                <p className={cn(captionClass, "text-muted-foreground")}>
                  {t(meta.emptyKey)}
                </p>
              </div>
            ) : (
              <AccountCardGrid columns={2}>
                {group.items.map((entry) => (
                  <AccountExpCard
                    key={entry.id}
                    label={t(meta.labelKey)}
                    title={entry.title}
                    imageUrl={entry.imageUrl}
                    imageAlt={entry.title}
                    href={entry.href}
                    action={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRemove(entry)}
                        disabled={pendingId === entry.id}
                        aria-label={t("favoriteRemoveLabel", { title: entry.title })}
                      >
                        <X className="size-3.5 text-muted-foreground" />
                      </Button>
                    }
                  />
                ))}
              </AccountCardGrid>
            )}
          </section>
        );
      })}

      <div className="page-container pt-6 pb-16 lg:pt-8 lg:pb-24">
        <Link
          href="/account"
          className={cn(
            captionClass,
            "text-muted-foreground transition-colors hover:text-foreground"
          )}
        >
          {t("backToAccountLink")}
        </Link>
      </div>
    </>
  );
}
