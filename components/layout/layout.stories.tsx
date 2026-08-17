import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Columns, Container, Grid, Section } from "./container";
import { Logo } from "./logo";

/**
 * ページ骨格の基盤部品 (C1)。
 * 値はすべて `tokens/base.json` の layout.* / spacing.* / component.* 経由。
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 — Header 5653:29 / Footer 5662:49 /
 * Logo / Wordmark 7964:242。
 */
const meta = {
  title: "01 Foundations/Layout",
  component: Container,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Container>;

export default meta;

type Story = StoryObj<typeof meta>;

const Block = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted text-muted-foreground border border-border p-4 text-sm">
    {children}
  </div>
);

/** 幅 = layout.container.xl (1312px)、外余白 = layout.grid.margin.desktop (64px)。 */
export const ContainerWide: Story = {
  args: { children: <Block>page-container (wide / 1312px)</Block> },
};

/** 長文ページ用。幅 = layout.container.md (768px)。 */
export const ContainerNarrow: Story = {
  args: {
    width: "narrow",
    children: <Block>page-container-narrow (narrow / 768px)</Block>,
  },
};

/** 縦余白は spacing トークンのみ (sm=32 / md=64 / lg=96px)。 */
export const SectionSpacings: Story = {
  render: () => (
    <>
      <Section spacing="sm">
        <Block>Section spacing=&quot;sm&quot; — py 2rem</Block>
      </Section>
      <Section spacing="md">
        <Block>Section spacing=&quot;md&quot; — py 4rem (Figma Footer と同値)</Block>
      </Section>
      <Section spacing="lg">
        <Block>Section spacing=&quot;lg&quot; — py 6rem</Block>
      </Section>
    </>
  ),
};

/** layout.grid: 4 / 8 / 12 カラム、溝 1rem / 1.5rem / 2rem。 */
export const BaselineGrid: Story = {
  render: () => (
    <Container>
      <Grid>
        {Array.from({ length: 12 }, (_, i) => (
          <Block key={i}>{i + 1}</Block>
        ))}
      </Grid>
    </Container>
  ),
};

/** Figma Footer / Columns 5663:49 と同じ 4 列 + 48px gap。 */
export const FooterColumns: Story = {
  render: () => (
    <Container>
      <Columns count={4} gap="lg">
        {["Brand", "Shop", "Content", "Support"].map((label) => (
          <Block key={label}>{label}</Block>
        ))}
      </Columns>
    </Container>
  ),
};

/** Logo / Wordmark 7964:242。高さは component.logo.height.* に束縛。 */
export const LogoSizes: Story = {
  render: () => (
    <Container>
      <div className="flex items-end gap-8 py-8">
        <Logo size="sm" />
        <Logo size="md" />
        <Logo size="lg" />
      </div>
    </Container>
  ),
};
