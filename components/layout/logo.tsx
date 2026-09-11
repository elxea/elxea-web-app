import Image from "next/image";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Logo (Wordmark) — Figma `Logo / Wordmark (Module)` 7964:242。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - Logo / Wordmark 7964:242 …… 99.8087 x 24 (縦横比 4.159)
 * - Header / Logo   7965:242 …… 66.539 x 16  (Header 内インスタンス)
 * - Footer / Brand / Logo 7965:248 …… 74.857 x 18 (Footer 内インスタンス)
 *
 * 表示高さは `component.logo.height.*` トークンに束縛し、幅は縦横比から自動で決まる
 * (`w-auto`)。呼び出し側で幅・高さを直書きしない。
 */
export type LogoSize = "sm" | "md" | "lg";

const LOGO_HEIGHT: Record<LogoSize, string> = {
  /** component.logo.height.sm = 1rem (16px) — Header */
  sm: "h-(--component-logo-height-sm)",
  /** component.logo.height.md = 1.125rem (18px) — Footer */
  md: "h-(--component-logo-height-md)",
  /** component.logo.height.lg = 1.5rem (24px) — 単体掲示 (Figma symbol 実寸) */
  lg: "h-(--component-logo-height-lg)",
};

/**
 * 元アセットの内在寸法。next/image が縦横比を保つために必要な値であって、
 * 画面上の見た目寸法ではない (見た目は上の height トークンが決める)。
 * Figma wordmark 99.8087 x 24 と同比。
 */
const INTRINSIC_WIDTH = 100;
const INTRINSIC_HEIGHT = 24;

export type LogoProps = Omit<
  React.ComponentProps<typeof Image>,
  "src" | "alt" | "width" | "height"
> & {
  size?: LogoSize;
};

export function Logo({ size = "sm", className, ...props }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="elxea"
      width={INTRINSIC_WIDTH}
      height={INTRINSIC_HEIGHT}
      data-slot="logo"
      data-logo-size={size}
      className={cn("w-auto", LOGO_HEIGHT[size], className)}
      {...props}
    />
  );
}
