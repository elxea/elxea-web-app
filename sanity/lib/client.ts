import { createClient, type SanityClient } from "next-sanity";

import { env, isProduction } from "@/lib/config";

/**
 * 憲章 R4「設定値は起動時検証・raw 読み禁止」への移行 (Wave 1 QA 指摘 / 2026-08-27)。
 *
 * この 4 つ (`NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` /
 * `NODE_ENV` / `SANITY_API_READ_TOKEN`) は Wave 1 の全件移行から漏れていた。
 * 理由は取りこぼしではなく **lint の網の形**で、`no-restricted-syntax` の
 * `files` が `app/**` `components/**` `lib/**` だけを見ており `sanity/**` が
 * 入っていなかった。装置は正しいのに一区画だけ素通しになっている状態は、
 * R8 が名指しする「導入したが移行しきっていない」そのものなので、
 * 生読みの除去と **フェンスの `sanity/**` への拡張を同じ変更で**行う。
 *
 * 値は `lib/config/spec.ts` に既に宣言済み (Wave 1 で登録されている) ため、
 * ここは読み口を差し替えるだけ。`NEXT_PUBLIC_*` のブラウザ向けインライン化も
 * spec 側の `read` が**リテラルの member expression** を保っているので効く。
 */
const projectId = env("NEXT_PUBLIC_SANITY_PROJECT_ID") ?? "";
const dataset = env("NEXT_PUBLIC_SANITY_DATASET") ?? "production";
const apiVersion = "2024-01-01";

function createSanityClient(options?: { preview?: boolean }): SanityClient {
  if (!projectId) {
    return new Proxy({} as SanityClient, {
      get(_, prop) {
        if (prop === "fetch") {
          return () => {
            throw new Error(
              "Sanity projectId is not configured. Set NEXT_PUBLIC_SANITY_PROJECT_ID."
            );
          };
        }
        return undefined;
      },
    });
  }

  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: isProduction() && !options?.preview,
    token: env("SANITY_API_READ_TOKEN") || undefined,
  });
}

export const sanityClient = createSanityClient();
export const previewClient = createSanityClient({ preview: true });

export function getClient(preview = false) {
  return preview ? previewClient : sanityClient;
}
