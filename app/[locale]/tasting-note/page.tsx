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
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-24">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Interactive
          </p>
          <h1 className="text-2xl font-normal">Tasting Note</h1>
        </div>
        <TastingNoteForm />
      </div>
    </div>
  );
}
