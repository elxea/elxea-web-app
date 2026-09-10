"use client";

import { Button } from "@/components/ui/button";

import { useVariantSelection } from "./variant-selection-context";
import type { ProductOption } from "./variant-selection-state";

/**
 * サイズ / タイプ / 種類の選択ボタン。**見た目だけ**を持つ。
 *
 * 選択の保持・解決・URL 同期は `VariantSelectionProvider` 側にある。
 * ここが `useSearchParams` / `useRouter` を触らないことが速さの条件で、
 * 触った瞬間に「押す → サーバ往復 → やっと枠が付く」に戻る
 * (`__tests__/variant-selection.test.ts` の契約テストが見張っている)。
 */
export function VariantSelector({ options }: { options: ProductOption[] }) {
  const { select, isSelected, isAvailable } = useVariantSelection();

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
                  data-slot="variant-option"
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  onClick={() => select(option.name, value)}
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
