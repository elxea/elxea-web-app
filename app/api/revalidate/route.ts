import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { parseBody } from "next-sanity/webhook";
import { env } from "@/lib/config";
import { isSanityDocumentType, tagsForSanityType } from "@/lib/cache/tags";
import { logger } from "@/lib/log";

/**
 * Sanity の webhook 受け口。**剥がす側**であり、貼る側は
 * `sanity/lib/fetch.ts` (`sanityFetch`)、対応表は `lib/cache/tags.ts`。
 *
 * ## ここが何を直したのか
 *
 * 直前まで、このルートは `revalidateTag(body._type)` を実行していた
 * (例: `revalidateTag("article")`)。しかしアプリ側で `"article"` という名札を
 * 貼っている箇所は 1 つも無かったため、**この呼び出しは構造として 100% 空振り**
 * していた。それでも 200 を返すので、Sanity 側の webhook 履歴も緑のまま。
 * 「更新したのに本番に出ない」だけが症状として残る状態だった。
 *
 * いまは名札を `lib/cache/tags.ts` の表からしか取らない。文字列リテラルを
 * ここに書かないこと自体が仕様で、`__tests__/cache-tags-registry.test.ts` が
 * 「`revalidateTag` に渡る文字列は全てレジストリに実在する」を検査する。
 *
 * ## 知らない `_type` が来たら
 *
 * 400 では返さない。この表に無い型は「アプリがどこからも読んでいない型」で
 * あることを突合テストが保証している (テストは `sanity/lib/queries.ts` と
 * `app/**` の GROQ に現れる `_type == "..."` を全て集めて表と突き合わせる)。
 * 読んでいない以上キャッシュも存在せず、剥がすものが無いのが正しい。
 * ただし黙って 200 を返すと修理前と見分けが付かないので、**何も剥がさなかった
 * ことを応答本文と server log の両方に明示**する。
 */
export async function POST(req: NextRequest) {
  try {
    const { isValidSignature, body } = await parseBody<{
      _type: string;
      slug?: { current: string };
    }>(req, env("SANITY_REVALIDATE_SECRET"));

    if (!isValidSignature) {
      return new NextResponse("Invalid signature", { status: 401 });
    }

    if (!body?._type) {
      return new NextResponse("Bad request", { status: 400 });
    }

    if (!isSanityDocumentType(body._type)) {
      console.warn(
        `[revalidate] unmapped Sanity document type: ${body._type} — no cache tag to expire`
      );
      return NextResponse.json({
        revalidated: false,
        reason: "unmapped-type",
        type: body._type,
        now: Date.now(),
      });
    }

    // `expire: 0` は「猶予なしで即座に捨てる」。webhook は「もう新しい本文が
    // ある」という通知なので、古い本文を配り続ける猶予を置く理由が無い。
    const tags = tagsForSanityType(body._type);
    for (const tag of tags) {
      revalidateTag(tag, { expire: 0 });
    }

    return NextResponse.json({
      revalidated: true,
      type: body._type,
      tags,
      now: Date.now(),
    });
  } catch (err) {
    /* 剥がせなかった = 古い本文が本番に残る。Sanity 側の webhook 履歴は
       赤くなるが、それを見に行く人はいないので必ず鳴らす。 */
    logger.error("api.revalidate.tag-expire-failed", err, {
      route: "/api/revalidate",
      status: 500,
    });
    return new NextResponse("Error revalidating", { status: 500 });
  }
}
