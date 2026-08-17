import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "./sheet";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "02 Elements/Sheet",
  component: Sheet,
  tags: ["autodocs"],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Sheet</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sheet Title</SheetTitle>
          <SheetDescription>
            Sheet description text goes here.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <p className="text-sm text-muted-foreground">
            Sheet body content.
          </p>
        </div>
        <SheetFooter>
          <Button>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const Left: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Left</Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Browse sections.</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-2 px-4">
          <a href="#" className="text-sm hover:underline">Home</a>
          <a href="#" className="text-sm hover:underline">About</a>
          <a href="#" className="text-sm hover:underline">Contact</a>
        </nav>
      </SheetContent>
    </Sheet>
  ),
};

export const Bottom: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open Bottom</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Bottom Sheet</SheetTitle>
          <SheetDescription>
            This slides up from the bottom.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 py-2">
          <p className="text-sm">Content area.</p>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const WithForm: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Edit Settings</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Update your preferences.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input id="displayName" defaultValue="User" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bio">Bio</Label>
            <Input id="bio" placeholder="Tell us about yourself" />
          </div>
        </div>
        <SheetFooter>
          <Button type="submit">Save changes</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
