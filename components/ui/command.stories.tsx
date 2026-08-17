import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Calculator,
  Calendar,
  CreditCard,
  Settings,
  Smile,
  User,
} from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "./command";

const meta = {
  title: "02 Elements/Command",
  component: Command,
  tags: ["autodocs"],
  parameters: {
    a11y: {
      // KNOWN ISSUE (story-scoped, rule-scoped): aria-required-children is
      // disabled ONLY for this story. cmdk emits role="listbox" on CommandList
      // and role="option" on CommandItem, but its internal [cmdk-list-sizer] /
      // presentation wrappers break axe's owned-children traversal (upstream
      // cmdk<>axe incompatibility, not an app-authored bug). Every other axe
      // rule stays active for this story.
      // color-contrast is repeated here because per-story a11y.config.rules
      // replaces (does not merge into) the global array in .storybook/preview.ts.
      // Tracking Issue (cmdk): https://app.notion.com/p/39a70c9d064c81aa82a4eadbcb15b992
      // Tracking Issue (color-contrast token): https://app.notion.com/p/39a70c9d064c818cbaceed6d628c4fd5
      config: {
        rules: [
          { id: "color-contrast", enabled: false },
          { id: "aria-required-children", enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Command className="rounded-lg border border-border shadow-md md:min-w-[450px]">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <Calendar />
            <span>Calendar</span>
          </CommandItem>
          <CommandItem>
            <Smile />
            <span>Search Emoji</span>
          </CommandItem>
          <CommandItem>
            <Calculator />
            <span>Calculator</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <User />
            <span>Profile</span>
            <CommandShortcut>Ctrl+P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <CreditCard />
            <span>Billing</span>
            <CommandShortcut>Ctrl+B</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Settings />
            <span>Settings</span>
            <CommandShortcut>Ctrl+S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
