import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 角丸は rounded-lg (8px) = Figma Buttons の `radius-lg`。shadcn 既定の
  // rounded-md (6px) からの Δ2px は c6-1 §5 注6 の既知差分で、DS トークン整合
  // タスクで Figma に寄せた (`component.button.radius.default` = 0.5rem と対応)。
  // size バリアント側で rounded-* を再指定しないこと (tailwind-merge で後勝ちし
  // ここの値が無効になる)。pill 形にしたい service / 個別指定は例外。
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground active:bg-accent/80 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/60",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80 dark:hover:bg-accent/50 dark:active:bg-accent/60",
        link: "text-primary underline-offset-4 hover:underline",
        // Figma BtnService (Module) 6953:124 — playlist などの外部サービス導線。
        // 塗りではなく細罫 + 矢印で、本文の流れを断たない見た目。
        service:
          "rounded-full border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        // Figma BtnService 6953:124 実測 …… 102 x 35 / Label x=20 / Arrow x=70
        // (= 左右 padding 20px = spacing.5、Label と Arrow の溝 8px = spacing.2)
        service:
          "h-(--component-button-height-service) gap-2 rounded-full px-5 text-xs",
        // Figma【R2: 確定版】イベント詳細 6657:7931 の面 CTA 実測 …… h43 /
        // px 24 (space.6) / radius-lg 8 / 本文と同じ 16px。「読み枠の中で行を
        // 占める申込ボタン」用で、既存 sm/default/lg (36-40px / 14px) より
        // 一段大きい。高さは component.button.height.cta トークンから解決する
        // (service と同じ作法。生 px は書かない)。
        cta: "h-(--component-button-height-cta) gap-2 px-6 text-base",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
