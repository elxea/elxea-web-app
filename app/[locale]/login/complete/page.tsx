import { getTranslations } from "next-intl/server";
import { LoginCompleteContent } from "./login-complete-content";

export async function generateMetadata() {
  const t = await getTranslations("loginComplete");
  return {
    title: t("title"),
  };
}

export default function LoginCompletePage() {
  return <LoginCompleteContent />;
}
