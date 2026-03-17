"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ProductVariant } from "@/lib/shopify/types";
import { Button } from "@/components/ui/button";

export function VariantSelector({
  options,
  variants,
}: {
  options: { id: string; name: string; values: string[] }[];
  variants: ProductVariant[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  function handleSelect(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(name, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function isSelected(name: string, value: string) {
    return searchParams.get(name) === value;
  }

  function isAvailable(name: string, value: string) {
    const currentSelections: Record<string, string> = {};
    options.forEach((opt) => {
      const selected = searchParams.get(opt.name);
      if (selected) currentSelections[opt.name] = selected;
    });
    currentSelections[name] = value;

    return variants.some(
      (variant) =>
        variant.availableForSale &&
        variant.selectedOptions.every(
          (opt) =>
            !currentSelections[opt.name] ||
            currentSelections[opt.name] === opt.value
        )
    );
  }

  if (options.length === 1 && options[0].values.length === 1) {
    return null;
  }

  return (
    <div className="space-y-6">
      {options.map((option) => (
        <div key={option.id}>
          <p className="text-sm font-medium mb-3">{option.name}</p>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const selected = isSelected(option.name, value);
              const available = isAvailable(option.name, value);
              return (
                <Button
                  key={value}
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSelect(option.name, value)}
                  disabled={!available}
                  aria-pressed={selected}
                  aria-label={`${option.name}: ${value}`}
                >
                  {value}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
