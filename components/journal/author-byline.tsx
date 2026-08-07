import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * AuthorByline — Figma
 * `AuthorByline (Proposed) — elxea/Journal 本文冒頭著者クレジット` 7552:238。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - symbol 7552:238 …… 208 x 40
 * - Avatar (photo) 7552:234 …… 32 x 32 (= component.avatar.size.sm)
 * - Name + Role 7552:235 …… x=44 (= 32 + 12 / spacing.3)
 *   - 氏名 7552:236 …… 13px 行高 20
 *   - 肩書 7552:237 …… 12px 行高 18
 *
 * 記事末尾のプロフィール枠 `author-profile.tsx` (Figma 6853:300) とは別部品。
 * こちらは本文冒頭の 1 行クレジットで、肩書きまでで完結する。
 */
export type AuthorBylineProps = React.ComponentProps<"div"> & {
  /** 著者名。 */
  name: string;
  /** 肩書き・所属。無い著者もいるので任意。 */
  role?: string;
  /** 顔写真 URL。無いときは頭文字のフォールバックを出す。 */
  avatarUrl?: string;
};

export function AuthorByline({
  name,
  role,
  avatarUrl,
  className,
  ...props
}: AuthorBylineProps) {
  return (
    <div
      data-slot="author-byline"
      className={cn("flex items-center gap-3", className)}
      {...props}
    >
      <Avatar className="size-(--component-avatar-size-sm)">
        {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
        <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        {/* Figma は 13px/20 と 12px/18 だが、スケール外の生値を書かない規律を
            優先し text-sm/leading-5 (14/20) と text-xs/leading-4 (12/16) に丸めた。 */}
        <span className="text-sm leading-5 text-foreground">{name}</span>
        {role && (
          <span className="text-xs leading-4 text-muted-foreground">
            {role}
          </span>
        )}
      </div>
    </div>
  );
}
