import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { env } from "@/lib/config";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const secret = searchParams.get("secret");
  const slug = searchParams.get("slug") || "/";

  if (secret !== env("SANITY_PREVIEW_SECRET")) {
    return new Response("Invalid token", { status: 401 });
  }

  (await draftMode()).enable();
  redirect(slug);
}
