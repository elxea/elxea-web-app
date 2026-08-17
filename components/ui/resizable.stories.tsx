import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

const meta = {
  title: "02 Elements/Resizable",
  component: ResizablePanelGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof ResizablePanelGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ResizablePanelGroup
      direction="horizontal"
      className="max-w-md rounded-lg border border-border md:min-w-[450px]"
    >
      <ResizablePanel defaultSize={50}>
        <div className="flex h-[200px] items-center justify-center p-6">
          <span className="font-semibold">One</span>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50}>
        <div className="flex h-[200px] items-center justify-center p-6">
          <span className="font-semibold">Two</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

export const Vertical: Story = {
  render: () => (
    <ResizablePanelGroup
      direction="vertical"
      className="max-w-md rounded-lg border border-border md:min-w-[450px]"
    >
      <ResizablePanel defaultSize={50}>
        <div className="flex h-[100px] items-center justify-center p-6">
          <span className="font-semibold">Top</span>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50}>
        <div className="flex h-[100px] items-center justify-center p-6">
          <span className="font-semibold">Bottom</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

export const ThreePanels: Story = {
  render: () => (
    <ResizablePanelGroup
      direction="horizontal"
      className="max-w-md rounded-lg border border-border md:min-w-[450px]"
    >
      <ResizablePanel defaultSize={25}>
        <div className="flex h-[200px] items-center justify-center p-6">
          <span className="font-semibold">Sidebar</span>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50}>
        <div className="flex h-[200px] items-center justify-center p-6">
          <span className="font-semibold">Content</span>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={25}>
        <div className="flex h-[200px] items-center justify-center p-6">
          <span className="font-semibold">Panel</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};
