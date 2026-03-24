"use client";

import { useCallback } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useChatContext } from "@/components/chat/chat-provider";

export function LoginCompleteContent() {
  const t = useTranslations("loginComplete");
  const { setIsOpen } = useChatContext();

  const handleOpenChat = useCallback(() => {
    setIsOpen(true);
  }, [setIsOpen]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Animated check mark */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.3 }}
          >
            <Check
              className="size-8 text-green-600 dark:text-green-400"
              strokeWidth={3}
              aria-hidden="true"
            />
          </motion.div>
        </motion.div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="space-y-3"
        >
          <h1 className="font-heading text-xl tracking-tight">
            {t("heading")}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("description")}
          </p>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="space-y-3"
        >
          <Button size="lg" className="w-full" asChild>
            <Link href="/">
              {t("exploreTea")}
            </Link>
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={handleOpenChat}
          >
            {t("startChat")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
