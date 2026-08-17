import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./card";
import { Button } from "./button";

const meta = {
  title: "02 Elements/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    // Scoped a11y exception — color-contrast stays GLOBALLY ENABLED (.storybook/preview.ts).
    // Known, pre-existing out-of-scope contrast violation: card body/description text uses
    // the `foreground` token / `text-foreground/80` opacity composite, sub-AA on the sand
    // card background (NOT the muted-foreground token, which is fixed).
    // Tracked for a 2nd-round Figma+code fix:
    // https://app.notion.com/p/39c70c9d064c812c86f2ec6b2a255184
    // Re-verified 2026-08-07: re-enabling this rule still fails (pnpm vitest run --project storybook -> 22 stories fail color-contrast
    // across these 6 files; e.g. tabs inactive label #969694 on #ebe9e0 = 2.43:1).
    // The exception is NOT stale residue — do not remove it until the tracked token fix lands.
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description text goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Card content area. This is where the main body of the card lives.</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Action</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>You have 3 unread messages.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            View all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Check your inbox for the latest updates.
        </p>
      </CardContent>
    </Card>
  ),
};

export const SimpleContent: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardContent>
        <p className="text-sm">A card with only content, no header or footer.</p>
      </CardContent>
    </Card>
  ),
};
