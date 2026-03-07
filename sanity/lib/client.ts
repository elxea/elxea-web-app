import { createClient, type SanityClient } from "next-sanity";

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
    useCdn: !options?.preview,
    token: options?.preview ? process.env.SANITY_API_READ_TOKEN : undefined,
  });
}

export const sanityClient = createSanityClient();
export const previewClient = createSanityClient({ preview: true });

export function getClient(preview = false) {
  return preview ? previewClient : sanityClient;
}
