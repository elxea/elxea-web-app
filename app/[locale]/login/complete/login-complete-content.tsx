"use client";

import { useCallback } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  AuthCard,
  AuthCardActions,
  AuthCardBanner,
  AuthCardDescription,
  AuthCardHeader,
  AuthCardMark,
  AuthCardTitle,
  AuthSection,
} from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useChatContext } from "@/components/chat/chat-provider";

/**
 * ログイン完了画面 — Figma【R2: 確定版】`AWLnI0XF07e8rScuxPYPc7`
 * section 6749:10277 / PC 6749:10278 / SP 6750:15880 / Complete Card 6750:10383
 *
 * 骨格はログイン画面と同じ認証カード (components/auth/auth-card.tsx)。
 * 完了マーク → 見出し → 連携完了バナー → アクション 2 件の順。
 * 登場アニメーションは Figma に無い実装側の追加 (静止状態は確定版と一致)。
 */
export function LoginCompleteContent() {
  const t = useTranslations("loginComplete");
  const { setIsOpen } = useChatContext();

  const handleOpenChat = useCallback(() => {
    setIsOpen(true);
  }, [setIsOpen]);

  return (
    <AuthSection>
      <AuthCard>
        {/* Check Circle 6750:10384 */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
        >
          <AuthCardMark>
            <Check className="size-8" strokeWidth={3} aria-hidden="true" />
          </AuthCardMark>
        </motion.div>

        {/* Heading 6750:10386 — 「連携完了」は確定版で weight 700 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="w-full"
        >
          <AuthCardHeader className="gap-3 md:gap-2">
            <AuthCardTitle emphasis="strong">{t("title")}</AuthCardTitle>
            <AuthCardDescription>{t("description")}</AuthCardDescription>
          </AuthCardHeader>
        </motion.div>

        {/* LinkSuccessBanner 6750:15802 — 完了画面では常時表示 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="w-full"
        >
          <AuthCardBanner tone="success">{t("heading")}</AuthCardBanner>
        </motion.div>

        {/* Actions 6750:15804 — SP は gap 12 / PC は 16 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="w-full"
        >
          <AuthCardActions className="gap-3 md:gap-4">
            <Button className="w-full shadow-xs" asChild>
              <Link href="/">{t("exploreTea")}</Link>
            </Button>

            <Button
              variant="secondary"
              className="w-full shadow-xs"
              onClick={handleOpenChat}
            >
              {t("startChat")}
            </Button>
          </AuthCardActions>
        </motion.div>
      </AuthCard>
    </AuthSection>
  );
}
