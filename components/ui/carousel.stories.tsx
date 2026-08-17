import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "./carousel";
import { Card, CardContent } from "./card";

const meta = {
  title: "02 Elements/Carousel",
  component: Carousel,
  tags: ["autodocs"],
} satisfies Meta<typeof Carousel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-xs">
      <Carousel>
        <CarouselContent>
          {Array.from({ length: 5 }).map((_, index) => (
            <CarouselItem key={index}>
              <Card>
                <CardContent className="flex aspect-square items-center justify-center p-6">
                  <span className="text-4xl font-semibold">{index + 1}</span>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  ),
};

export const ThreePerView: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-sm">
      <Carousel>
        <CarouselContent className="-ml-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <CarouselItem key={index} className="basis-1/3 pl-2">
              <Card>
                <CardContent className="flex aspect-square items-center justify-center p-2">
                  <span className="text-2xl font-semibold">{index + 1}</span>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  ),
};
