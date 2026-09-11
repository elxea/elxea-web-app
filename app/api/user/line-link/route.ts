import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { unlinkLineUser } from "@/lib/firebase/server-actions";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { requestCxUnlink } from "@/lib/line/unlink";
import {
  fetchShopifyCustomerIdForLineUser,
  invalidateReverseLinkage,
  invalidateReverseLinkageForCustomer,
} from "@/lib/line/linkage-status";
import { readVerifiedLineUserId } from "@/lib/line/session";

/**
 * ## POST は廃止した (P10 / 2026-08-22)
 *
 * かつてここには「ブラウザが `{ lineUserId }` を送ってきたら、その LINE を
 * ログイン中の顧客に連携する」という POST があった。**LINE に何も検証させていない**
 * ので、任意の LINE userId を名乗って自分のアカウントに結び付けられる — 連携と
 * 呼べる代物ではなかった (「連携した」と画面に出るが、実際に Bot が読む台帳
 * `customer_linkages` には何も起きない偽の連携でもあった)。
 *
 * いま連携が成立する経路は、いずれも **LINE 自身に id_token を検証させてから**
 * cx-agent の台帳に書く 3 つだけ。
 *   - `GET  /api/user/line-link/callback` … マイページの連携ボタン (Web)
 *   - `POST /api/user/line-link-liff`     … LIFF (トーク内)
 *   - `GET  /api/auth/callback`           … メールログイン時の取りこぼし再試行
 *
 * 本番にこの POST の呼び出し元は無い (e2e が疎通確認で叩いていただけ)。
 * ルート自体は DELETE のために残るので、POST には 405 が返る。
 */

/**
 * DELETE /api/user/line-link
 *
 * 連携解除。同じ認証機構で、ログイン済みご本人の連携情報だけを外す。解除後は
 * 通常の連携導線 (`/api/user/line-link/callback` / LIFF) で再連携できる
 * (`unlinkLineUser` が `lineUserId` フィールドごと消すため、再連携は
 * 「未連携からの新規連携」を通る)。
 *
 * 設計上の要点:
 *   - 解除対象は **サーバ認証済みセッション (requireAuth) で確定した customerId** の
 *     連携のみ。ブラウザからの customerId / lineUserId は一切受け取らない
 *     (body を読まない = 他人の連携を指定して外す経路が存在しない)。
 *   - 未ログインは 401 で、Firestore には触れない。
 *   - 冪等: 連携が無ければ 200 + `action: "not_linked"`。二重解除・再送を
 *     エラーにしない (解除は「連携が無い状態にする」操作)。
 *   - 解除 != データ削除。カルテ・注文履歴は消さない (削除は GDPR
 *     `customers/redact` webhook の担当)。
 *
 * ## 解除の実体は 2 か所にある — 順序が結果を決める
 *
 * LINE Bot が実際に読む連携台帳は cx-agent 側 (`customer_linkages`) にあり、
 * Firestore の `lineUserId` はその写しに過ぎない。以前の実装は Firestore しか
 * 消さずに 200 を返していたため、**解除したはずの人に LINE の配信が届き続けた**
 * (route 自身が「cx-agent には解除用 HTTP エンドポイントが無い」と自認していた)。
 *
 * 現在は cx-agent に `POST /api/identity/unlink` (既存 `clearCustomerLinkage` への
 * HTTP 入口) があるので、**必ず cx-agent を先に呼び、成功したときだけ Firestore を
 * 消す**。順序が逆だと、cx が失敗したときに写しだけ消えて「画面は未連携・実際は
 * 連携中」というより悪い割れ方になる。
 *
 * ## 成功偽装をしない (本 route の主旨)
 *
 * cx-agent が失敗したら **Firestore に触れず非 2xx を返す**。
 *   - 502 … cx-agent に届かない / 上流エラー
 *   - 503 … このデプロイに連携の設定が無い (`SYNC_API_SECRET` 未設定)
 * 呼び出し側 (マイページ) は非 2xx を「解除できませんでした」として出す。
 * ここで 200 を返すのは、今まさに直している嘘そのもの。
 *
 * ## LINE セッションでも解除できる (2026-08-22 / A 案)
 *
 * `requireAuth()` は **Shopify セッション専用**なので、LINE でログインしている人は
 * ここに来ても 401 だった。一方マイページ側も解除ボタンを Shopify セッションのときしか
 * 出していなかったため、**LINE で入った人は自分の連携を自分で外せなかった**。
 * 外部アカウント連携は「利用者がいつでも自分で解除できる」ことが期待される操作なので、
 * LINE セッションからの解除を受け付ける。
 *
 * 受け付けても信頼境界は動かない。解除対象は依然として **サーバ確定値だけ**から決まる:
 *   - LINE userId は暗号化 cookie `line_uid` の復号結果 (`readVerifiedLineUserId`)。
 *     ブラウザ自己申告の値は一切受け取らない (body は読まないまま)
 *   - その LINE userId が **連携台帳の上で結び付いている** Shopify 顧客だけを外す
 *     (`fetchShopifyCustomerIdForLineUser`)。顧客 ID を推測しない
 * つまり「自分の LINE に結び付いている連携」以外は指定しようがない。
 *
 * 台帳が読めなかったとき (`null`) は **502**。ここを 200 にすると「解除しました」と
 * 言って何も外していない — この route が直している嘘そのものを別経路で作り直すことになる。
 */
export async function DELETE(request: NextRequest) {
  try {
    /* --- 経路 1: Shopify セッション (従来どおり) --- */
    const auth = await requireAuth();
    if (auth.authenticated) {
      const limited = await enforceRateLimit(
        request,
        limiters.authedUser,
        auth.customerId,
      );
      if (limited) return limited;

      return await unlinkForCustomer(auth.customerId);
    }

    /* --- 経路 2: LINE セッション (A 案で追加) --- */
    const lineUserId = await readVerifiedLineUserId();
    if (!lineUserId) {
      // どちらのセッションも無い。従来どおり requireAuth の 401 を返す。
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    /* rate limit の識別子は LINE userId。数値の顧客 ID と衝突しないよう接頭辞を付ける
       (Firestore の userKey 命名と同じ `line:` 名前空間)。台帳を引く前に効かせる。 */
    const limited = await enforceRateLimit(
      request,
      limiters.authedUser,
      `line:${lineUserId}`,
    );
    if (limited) return limited;

    const linkedCustomerId = await fetchShopifyCustomerIdForLineUser(lineUserId);

    if (linkedCustomerId === null) {
      // 台帳が読めない。外せたと偽らない (fail-CLOSED)。
      return NextResponse.json(
        { error: "Failed to unlink LINE account" },
        { status: 502 },
      );
    }

    if (linkedCustomerId === false) {
      // 冪等: 連携が無い (二重解除・再送をエラーにしない)。
      return NextResponse.json({ success: true, action: "not_linked" });
    }

    /* 外すのは **この LINE の連携だけ**。世帯共有 (1 顧客に複数 LINE) のとき、
       自分の解除で家族の連携まで巻き添えにしない (P8)。 */
    const response = await unlinkForCustomer(linkedCustomerId, lineUserId);

    /* 逆引きキャッシュ (最大 60 秒) を捨てる。捨てないと、解除した本人が引き直した
       マイページに「連携済み」がしばらく残り、解除できていないように見える。 */
    if (response.ok) invalidateReverseLinkage(lineUserId);

    return response;
  } catch (err) {
    console.error("[DELETE /api/user/line-link]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * 解除の本体 (どちらのセッション経路でも同じ順序で外す)。
 *
 * 順序が結果を決める: **cx-agent (正本) を先に外し、成功したときだけ Firestore (写し)**。
 * 逆だと cx が失敗したときに写しだけ消えて「画面は未連携・実際は連携中」という
 * より悪い割れ方になる。
 *
 * ## 「解除できました」は台帳が決める (P9 / 2026-08-22)
 *
 * 応答の `action` は以前 **Firestore の写しだけ**を見て決めていた。ところが Web / LIFF
 * から連携した人にはこの写しが一度も書かれておらず (書いていたのは廃止した POST だけ)、
 * **台帳からは実際に外れたのに `not_linked` = 「連携していませんでした」と返る**という
 * 食い違いが起きていた。連携の正本は台帳なので、`action` も台帳の結果 (`clearedCount`)
 * から決める。写しの掃除は続けるが、判定には使わない。
 *
 * @param customerId **サーバ確定**の Shopify 顧客 ID
 *   (requireAuth の結果、または検証済み LINE userId から台帳で引いた連携先)。
 * @param lineUserId 任意。**サーバ検証済み**の LINE userId。渡すとその 1 件だけを外す
 *   (世帯共有で家族の連携を巻き添えにしない・P8)。
 */
async function unlinkForCustomer(
  customerId: string,
  lineUserId?: string,
): Promise<NextResponse> {
  /* 1) 連携の正本 (cx-agent) を先に外す。ここが失敗したら Firestore は触らない。 */
  const cx = await requestCxUnlink(customerId, lineUserId);
  if (!cx.ok) {
    const status = cx.reason === "not_configured" ? 503 : 502;
    return NextResponse.json(
      { error: "Failed to unlink LINE account" },
      { status },
    );
  }

  /* 2) 写し (Firestore) を消す。冪等なので cx 側が 0 件でも安全に通る。
        写しが元から無い顧客 (Web / LIFF 連携組) でも失敗しない。 */
  await unlinkLineUser(customerId, lineUserId);

  /* 3) メールセッションからの解除では、外した LINE userId が分からないまま
        逆引きキャッシュに「連携済み」が最大 60 秒残る。残っている間にその人が
        LINE 側から画面を開くと、解除したはずの顧客の棚が見える。連携先の顧客 ID
        から引いて捨てる (cx-agent に生 ID を返させずに窓を閉じる・P6/E1)。 */
  invalidateReverseLinkageForCustomer(customerId);

  return NextResponse.json({
    success: true,
    action: cx.clearedCount > 0 ? "unlinked" : "not_linked",
  });
}
