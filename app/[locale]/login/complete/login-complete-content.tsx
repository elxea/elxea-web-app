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
      {/* Card (変A / 成功状態を枠付きカードに集約) */}
      <div className="w-full max-w-sm rounded-lg border border-border bg-card px-6 py-10 md:px-8 md:py-12">
        <div className="flex flex-col items-center gap-8 text-center">
          {/* Animated check mark */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
            className="flex size-16 items-center justify-center rounded-full bg-success/25"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.3 }}
            >
              <Check
                className="size-8 text-success-foreground"
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
            className="flex flex-col gap-3"
          >
            <h1 className="font-heading text-xl tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
          </motion.div>

          {/* Action buttons + status pill */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.6 }}
            className="flex w-full flex-col gap-3"
          >
            <p className="rounded-md border border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
              {t("heading")}
            </p>

            <Button size="lg" className="w-full" asChild>
              <Link href="/">{t("exploreTea")}</Link>
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
    </div>
  );
}
