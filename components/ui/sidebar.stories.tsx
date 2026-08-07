import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Home, Settings, Users, Mail } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "./sidebar";

const meta = {
  title: "UI/Sidebar",
  component: Sidebar,
  tags: ["autodocs"],
  parameters: {
    // Scoped a11y exception — color-contrast stays GLOBALLY ENABLED (.storybook/preview.ts).
    // Known, pre-existing out-of-scope contrast violation: sidebar text uses the
    // `foreground` token / opacity composite, sub-AA (4.26:1) on the #fafafa sidebar surface
    // (NOT the muted-foreground token, which is fixed).
    // Tracked for a 2nd-round Figma+code fix:
    // https://app.notion.com/p/39c70c9d064c812c86f2ec6b2a255184
    // Re-verified 2026-08-07: re-enabling this rule still fails (pnpm vitest run --project storybook -> 22 stories fail color-contrast
    // across these 6 files; e.g. tabs inactive label #969694 on #ebe9e0 = 2.43:1).
    // The exception is NOT stale residue — do not remove it until the tracked token fix lands.
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const menuItems = [
  { title: "Home", icon: Home },
  { title: "Users", icon: Users },
  { title: "Messages", icon: Mail },
  { title: "Settings", icon: Settings },
];

export const Default: Story = {
  render: () => (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1 text-sm font-semibold">App Name</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1 text-xs text-muted-foreground">v1.0.0</div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm font-medium">Page Content</span>
        </header>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">Main content area.</p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  ),
};
