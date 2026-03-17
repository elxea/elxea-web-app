"use client";

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

  function handleFilter(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) {
      params.set("category", slug);
    } else {
      params.delete("category");
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2 mb-8">
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
