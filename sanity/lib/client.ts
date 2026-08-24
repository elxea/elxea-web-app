import { createClient, type SanityClient } from "next-sanity";

import { getTeaMenuFixture, isDevFixtureSlug } from "./dev-fixtures";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
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
    useCdn: process.env.NODE_ENV === "production" && !options?.preview,
    token: process.env.SANITY_API_READ_TOKEN || undefined,
  });
}

export const sanityClient = createSanityClient();
export const previewClient = createSanityClient({ preview: true });

/**
 * dev fixture 差し込み層。
 *
 * `slug` が `fixture-` で始まる問い合わせだけを横取りしてダミーを返す。
 * 本番ビルド (`NODE_ENV === "production"`) では `isDevFixtureSlug` が常に false を
 * 返すので、この層は素通りする。理由と使い方は `./dev-fixtures` を参照。
 */
function withDevFixtures(client: SanityClient): SanityClient {
  if (process.env.NODE_ENV === "production") return client;

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "fetch") return Reflect.get(target, prop, receiver);
      return (query: string, params?: Record<string, unknown>, ...rest: unknown[]) => {
        const slug = params?.slug;
        if (isDevFixtureSlug(slug)) {
          return Promise.resolve(getTeaMenuFixture(slug));
        }
        return (target.fetch as (...a: unknown[]) => unknown)(query, params, ...rest);
      };
    },
  }) as SanityClient;
}

export function getClient(preview = false) {
  return withDevFixtures(preview ? previewClient : sanityClient);
}
