"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

type Category = {
  _id: string;
  title: string;
  slug: { current: string };
};

type CategoryFilterProps = {
  categories: Category[];
  activeSlug: string | null;
  allLabel: string;
};

export function CategoryFilter({ categories, activeSlug, allLabel }: CategoryFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleFilter(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) {
      params.set("category", slug);
    } else {
      params.delete("category");
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={`flex flex-wrap gap-2 mb-8 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <Button
        variant={activeSlug === null ? "default" : "ghost"}
        size="sm"
        className="text-xs"
        onClick={() => handleFilter(null)}
      >
        {allLabel}
      </Button>
      {categories.map((cat) => (
        <Button
          key={cat._id}
          variant={activeSlug === cat.slug.current ? "default" : "ghost"}
          size="sm"
          className="text-xs"
          onClick={() => handleFilter(cat.slug.current)}
        >
          {cat.title}
        </Button>
      ))}
    </div>
  );
}
