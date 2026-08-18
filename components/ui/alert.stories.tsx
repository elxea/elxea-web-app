import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AlertCircle, Terminal } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "./alert";

const meta = {
  title: "UI/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: {
    // Scoped a11y exception — color-contrast stays GLOBALLY ENABLED (.storybook/preview.ts).
    // Known, pre-existing out-of-scope contrast violations (NOT the muted-foreground token,
    // which is fixed).
    // C6-1R update: the `destructive` clause of this note is now stale on two counts.
    //   (a) The token was #b9525c (drifted); it is now the Figma value #ae4751.
    //   (b) The surface quoted here was sand #d5d3c0 (the pre-C5-1 `card`); `card` is now
    //       #f4f3ed. The old pair measured 3.137:1; Alert destructive now measures
    //       4.944:1 (title/icon) on the current card, and the description no longer
    //       carries /90 opacity. So Alert's own destructive text passes AA.
    // What still fails here is the rest of the overview (tabs inactive label etc.), so the
    // exception stays. Tracked for a 2nd-round Figma+code fix:
    // https://app.notion.com/p/39c70c9d064c812c86f2ec6b2a255184
    // Re-verified 2026-08-07: re-enabling this rule still fails (pnpm vitest run --project storybook -> 22 stories fail color-contrast
    // across these 6 files; e.g. tabs inactive label #969694 on #ebe9e0 = 2.43:1).
    // The exception is NOT stale residue — do not remove it until the tracked token fix lands.
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert>
      <Terminal className="size-4" />
      <AlertTitle>Heads up!</AlertTitle>
      <AlertDescription>
        You can add components to your app using the CLI.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again.
      </AlertDescription>
    </Alert>
  ),
};
