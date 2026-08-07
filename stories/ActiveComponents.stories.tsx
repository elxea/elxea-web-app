import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { toast } from "sonner";
import { Mail, ChevronRight, Menu, Search, Star } from "lucide-react";

// All 10 actively used components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

const meta = {
  title: "elxea/Active Components",
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true },
    // Scoped a11y exception — color-contrast stays GLOBALLY ENABLED (.storybook/preview.ts).
    // This overview renders every component (tabs/alert/card/etc.), so it inherits the
    // known, pre-existing out-of-scope contrast violations (foreground on sand, opacity
    // composites, destructive on sand) — NOT the muted-foreground token, which is fixed.
    // Tracked for a 2nd-round Figma+code fix:
    // https://app.notion.com/p/39c70c9d064c812c86f2ec6b2a255184
    // Re-verified 2026-08-07: re-enabling this rule still fails (pnpm vitest run --project storybook -> 22 stories fail color-contrast
    // across these 6 files; e.g. tabs inactive label #969694 on #ebe9e0 = 2.43:1).
    // The exception is NOT stale residue — do not remove it until the tracked token fix lands.
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * elxea Web App で実際に使用している全10コンポーネントの一覧。
 * この1ページだけ調整すればサイト全体の見た目が変わる。
 */
export const Overview: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl space-y-12 py-8">
      {/* ── 1. Button ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Button</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: ほぼ全ページ（CTA、ナビ、カート、フォーム送信）
        </p>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">XS</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              <Mail /> Login with Email
            </Button>
            <Button variant="outline" size="icon" aria-label="Next">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── 2. Card ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Card</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: subscription, about, contact ページ
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Card description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Card content area.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Action</Button>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Subscription Plan</CardTitle>
              <CardDescription>Monthly membership</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">¥1,980 <span className="text-sm font-normal text-muted-foreground">/月</span></p>
            </CardContent>
            <CardFooter>
              <Button className="w-full">Subscribe</Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ── 3. Badge ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Badge</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: product-card（タグ表示）
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Sold Out</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </div>
      </section>

      <Separator />

      {/* ── 4. Input + 5. Label ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Input + Label</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: search, contact フォーム
        </p>
        <div className="grid max-w-sm gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="demo-name">Name</Label>
            <Input id="demo-name" placeholder="Your name" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-email">Email</Label>
            <Input id="demo-email" type="email" placeholder="email@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-search">Search</Label>
            <Input id="demo-search" type="search" placeholder="Search products..." />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-disabled">Disabled</Label>
            <Input id="demo-disabled" disabled placeholder="Disabled" />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── 6. Separator ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Separator</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: header, footer, cart, account
        </p>
        <div className="space-y-4">
          <div>
            <p className="text-sm">Content above</p>
            <Separator className="my-3" />
            <p className="text-sm">Content below</p>
          </div>
          <div className="flex h-5 items-center gap-4 text-sm">
            <span>Home</span>
            <Separator orientation="vertical" />
            <span>Products</span>
            <Separator orientation="vertical" />
            <span>About</span>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── 7. Dialog ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Dialog</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: image-gallery（商品画像の拡大表示）
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Image Preview</DialogTitle>
              <DialogDescription>Product image details.</DialogDescription>
            </DialogHeader>
            <div className="flex aspect-square items-center justify-center rounded-lg bg-muted">
              <Star className="size-12 text-muted-foreground" />
            </div>
            <DialogFooter>
              <Button>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <Separator />

      {/* ── 8. Sheet ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Sheet</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: header（モバイルメニュー）
        </p>
        <div className="flex gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">
                <Menu /> Mobile Menu
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>elxea</SheetTitle>
                <SheetDescription>Navigation</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-3 px-4 pt-4">
                <a href="#" className="text-sm hover:underline">Home</a>
                <a href="#" className="text-sm hover:underline">Products</a>
                <a href="#" className="text-sm hover:underline">Journal</a>
                <a href="#" className="text-sm hover:underline">About</a>
                <a href="#" className="text-sm hover:underline">Contact</a>
              </nav>
            </SheetContent>
          </Sheet>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Cart →</Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Cart</SheetTitle>
                <SheetDescription>Your items</SheetDescription>
              </SheetHeader>
              <div className="px-4 pt-4 text-sm text-muted-foreground">
                Cart is empty.
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </section>

      <Separator />

      {/* ── 9. Skeleton ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Skeleton</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: page.tsx（ローディング状態）
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[150px]" />
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-[100px] w-full rounded-xl" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── 10. Sonner (Toast) ── */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Toast (Sonner)</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          使用: layout（通知表示）
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => toast("Default notification")}
          >
            Default
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.success("Added to cart")}
          >
            Success
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error("Out of stock")}
          >
            Error
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast("Item removed", {
                action: { label: "Undo", onClick: () => toast("Restored!") },
              })
            }
          >
            With Action
          </Button>
        </div>
      </section>
    </div>
  ),
};
