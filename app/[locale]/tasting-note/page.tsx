import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TastingNoteForm } from "./tasting-note-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tastingNote");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function TastingNotePage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <TastingNoteForm />
      </div>
    </div>
  );
}
