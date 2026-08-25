import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { FavoritesBoard } from "@/components/account/favorites-board";
import { FavoritesSeed } from "@/components/favorites/favorites-seed";
import { captionClass } from "@/components/editorial/rule-list";
import { Button } from "@/components/ui/button";
import { isSignedIn, type AccountAuth } from "@/lib/account-capabilities";
import {
  favoriteKey,
  groupFavorites,
  normalizeFavorites,
  type FavoriteGroup,
} from "@/lib/account-favorites";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { getFavorites } from "@/lib/firebase/server-actions";
import { seedFavorites } from "@/lib/preview-seed";
import { getCustomerFromSession } from "@/lib/shopify/auth";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("favorites") };
}

/**
 * お気に入り一覧 /ja/account/favorites。
 *
 * ## なぜ作ったか
 *
 * お気に入りはマイページ本体の「続き」節に **2 枚だけ** 出ていて、残りを見る場所が
 * 無かった (「すべて見る」はジャーナル一覧へ飛ぶだけで、自分のお気に入りではない)。
 * 外す手段も画面上に無く、商品ページ / 記事ページへ行って解除するしかなかった。
 * Setaka 要望 2026-08-25: 種類別に分けて / 一覧で見られて / その場で解除できて /
 * 表示件数を増やす。本ページがその 4 つを引き受け、マイページ本体は抜粋 (6 枚) と
 * ここへの導線だけを持つ。
 *
 * ## 何をサーバでやるか
 *
 * ログイン判定と一覧の取得はここ (サーバ) で閉じる。クライアントに渡すのは
 * 正規化済みの `FavoriteGroup[]` だけで、識別子 (userKey / LINE userId) は渡さない。
 * 解除操作だけが `FavoritesBoard` (client) の仕事で、DELETE /api/user/favorites を
 * 叩く。API は同じ `resolveIdentity()` で本人確認するので、ここで持ち回る必要は無い。
 *
 * **件数はここで数えない。** 見出しと合計件数 (`AccountTitleBlock`) の描画も
 * `FavoritesBoard` の側にある。以前はここで `countFavorites(groups)` を数えて
 * 描いていたが、サーバで一度きりの値なので解除しても変わらず、「カードは消えたのに
 * 合計は 3件のまま」になっていた (F14 / 本番実測 2026-08-25)。件数は解除の状態を
 * 持っている側だけが数える — ここが数え直すと同じ壊れ方が戻る。
 *
 * ## ログイン経路
 *
 * お気に入りは Firestore 側にあり `resolveIdentity()` が LINE の識別子でも解決するので、
 * **メール (Shopify) でも LINE でも見られる**。定期便のような「メール連携が要る」
 * 案内は出さない (`lib/account-capabilities.ts` で favorites は `signed-in`)。
 */
export default async function FavoritesPage() {
  const t = await getTranslations("account");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  let customer = null;
  try {
    customer = await getCustomerFromSession();
  } catch {
    // fall through — LINE セッションの有無を下で見る
  }

  /* 計測用の見本 (PREVIEW_SEED=1 のときだけ)。実セッションがあるときは呼ばない。
     フラグ未設定なら null なので、production の描画は見本導入前と同じ。 */
  const seeded = customer ? null : seedFavorites();

  const cookieStore = await cookies();
  const auth: AccountAuth = {
    shopify: Boolean(customer || seeded),
    line: cookieStore.has("line_session"),
  };

  if (!isSignedIn(auth)) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
        <div className="max-w-sm text-center">
          <h1 className="page-title mb-4 text-foreground">{t("favorites")}</h1>
          <p className={cn(captionClass, "mb-8 text-muted-foreground")}>
            {t("loginRequired")}
          </p>
          <Button variant="outline" asChild>
            <a href={`/${locale}/login`}>{tCommon("login")}</a>
          </Button>
        </div>
      </div>
    );
  }

  const entries = normalizeFavorites(seeded ?? (await loadFavorites()));
  const groups: FavoriteGroup[] = groupFavorites(entries);

  return (
    <>
      {/* 保存トグルへ渡す初期値 (描画はしない)。この画面の一覧はサーバで数えて
          いるので、同じ事実をブラウザ側の倉庫にも渡しておく。 */}
      <FavoritesSeed
        keys={entries.map((entry) => favoriteKey(entry.kind, entry.targetId))}
      />
      <FavoritesBoard groups={groups} />
    </>
  );
}

/**
 * Firestore からお気に入りを全件読む (createdAt 降順)。
 *
 * 種類での絞り込みはしない — 1 回で取って画面側で種類別に分けるほうが、
 * 種類の数だけ問い合わせるより速く、種類が増えても問い合わせが増えない。
 * 失敗しても落とさず空にする (一覧が空で出るだけ)。
 */
async function loadFavorites(): Promise<Awaited<ReturnType<typeof getFavorites>>> {
  try {
    const identity = await resolveIdentity();
    if (!identity.authenticated) return [];
    return await getFavorites(identity.userKey);
  } catch {
    return [];
  }
}
