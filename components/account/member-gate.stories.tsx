import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";

/**
 * MemberGate is an async server component that depends on next-intl server
 * functions (getTranslations, getLocale). It cannot be rendered directly
 * in Storybook. This story provides a visual preview of the component's
 * layout and styling using static markup.
 */

function MemberGatePreview() {
  return (
    <div className="mt-8 py-12 text-center border-t border-border">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
        Members Only
      </p>
      <p className="text-muted-foreground text-sm mb-8 max-w-md mx-auto">
        This content is available exclusively for members. Please log in to
        access it.
      </p>
      <Button variant="outline" asChild>
        <a href="#">Log In</a>
      </Button>
    </div>
  );
}

const meta = {
  title: "UI/MemberGate",
  component: MemberGatePreview,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Server component that gates content behind authentication. This story shows a static preview since the actual component uses next-intl server functions.",
      },
    },
  },
} satisfies Meta<typeof MemberGatePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
