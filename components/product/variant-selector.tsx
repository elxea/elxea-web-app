"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ProductVariant } from "@/lib/shopify/types";

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
          <p className="text-[13px] font-medium mb-3">{option.name}</p>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const selected = isSelected(option.name, value);
              const available = isAvailable(option.name, value);
              return (
                <button
                  key={value}
                  onClick={() => handleSelect(option.name, value)}
                  disabled={!available}
                  aria-pressed={selected}
                  aria-label={`${option.name}: ${value}`}
                  className={`px-4 py-2.5 text-[13px] border transition-colors ${
                    selected
                      ? "border-charcoal bg-charcoal text-cream"
                      : available
                        ? "border-border text-charcoal hover:border-charcoal"
                        : "border-border text-light cursor-not-allowed"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
