"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  AccountCardGrid,
  AccountExpCard,
  AccountSectionHeader,
} from "@/components/account/account-parts";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  FAVORITE_KIND_META,
  indexOfFavorite,
  insertFavoriteIntoGroups,
  removeFavoriteFromGroups,
  type FavoriteEntry,
  type FavoriteGroup,
} from "@/lib/account-favorites";
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

  async function handleRemove(entry: FavoriteEntry) {
    if (pendingId !== null) return;
    setPendingId(entry.id);

    /* 楽観更新。復元に要るのは「元の添字」だけなので、状態そのもののコピーは
       持たない (連続で解除したとき、古いコピーで全体を巻き戻さないため)。 */
    const originalIndex = indexOfFavorite(groups, entry);
    setGroups((current) => removeFavoriteFromGroups(current, entry.id));

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
      toast.error(t("actionError"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
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
