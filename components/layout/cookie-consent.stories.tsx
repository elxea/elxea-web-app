import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";

/**
 * CookieConsent depends on next-intl (useTranslations) and localStorage.
 * This story provides a static visual preview of the component's layout.
 */

function CookieConsentPreview() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-muted-foreground flex-1">
          We use cookies to improve your experience.{" "}
          <a
            href="#"
            className="underline hover:text-foreground transition-colors"
          >
            Learn more
          </a>
        </p>
        <div className="flex gap-3 shrink-0">
          <Button variant="outline" size="sm">
            Decline
          </Button>
          <Button size="sm">Accept</Button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "UI/CookieConsent",
  component: CookieConsentPreview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Fixed-position cookie consent banner. This story shows a static preview since the actual component uses next-intl hooks.",
      },
    },
  },
} satisfies Meta<typeof CookieConsentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
