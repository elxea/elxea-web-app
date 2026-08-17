import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from "./navigation-menu";

const meta = {
  title: "02 Elements/NavigationMenu",
  component: NavigationMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Getting Started</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink href="#">
                <div className="font-medium">Introduction</div>
                <p className="text-muted-foreground">
                  Overview of the platform.
                </p>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Installation</div>
                <p className="text-muted-foreground">
                  How to get started quickly.
                </p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Components</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink href="#">
                <div className="font-medium">Button</div>
                <p className="text-muted-foreground">
                  Clickable action elements.
                </p>
              </NavigationMenuLink>
              <NavigationMenuLink href="#">
                <div className="font-medium">Card</div>
                <p className="text-muted-foreground">
                  Container for content sections.
                </p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#">Documentation</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};

export const WithoutViewport: Story = {
  render: () => (
    <NavigationMenu viewport={false}>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Menu</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-2 p-4 w-[200px]">
              <NavigationMenuLink href="#">Option A</NavigationMenuLink>
              <NavigationMenuLink href="#">Option B</NavigationMenuLink>
              <NavigationMenuLink href="#">Option C</NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};
