import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SkeletonBar — Figma `Skeleton / Bar (Module) — elxea/共通 読込中プレースホルダ`
 * (8179:347)。
 *
 * 読込中プレースホルダの最小単位。幅・高さは使う側で指定する。
 *
 * なぜ `components/ui/skeleton.tsx` を使わないか (Figma の注記そのまま):
 * ベンダーキットの shadcn/skeleton は塗りが `bg-accent` に束縛されていて、
 * elxea では accent = brand gold (#ffc200) なので、読込中の画面が金色の板で
 * 埋まる。「まだ来ていない情報」を最も強い装飾色で描くのは意味が逆なので、
 * 単体の矩形プリミティブを mode/muted で新設した (Figma 側も同じ判断で
 * ACCEPTED-NP として新設している)。
 *
 * ベンダー側の `Skeleton` は他画面がそのまま使っているためここでは触らない。
 * 金色のままで良いはずはないので、DS 全体の置換は別タスクで行うこと。
 *
 * Figma 実測 → 実装:
 * - 塗り   mode/muted   → `bg-muted`
 * - 角丸   radius-sm 4  → `rounded-sm`
 * - 動き   Figma は静止で表現し、実装側の pulse に委ねる → `animate-pulse`
 */
export function SkeletonBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton-bar"
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-muted", className)}
      {...props}
    />
  );
}
