import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import React from "react";

/** Tailwind v4 default spacing scale (0.25rem base) */
const spacingScale = [
  { name: "0", rem: "0rem", px: "0px" },
  { name: "px", rem: "1px", px: "1px" },
  { name: "0.5", rem: "0.125rem", px: "2px" },
  { name: "1", rem: "0.25rem", px: "4px" },
  { name: "1.5", rem: "0.375rem", px: "6px" },
  { name: "2", rem: "0.5rem", px: "8px" },
  { name: "2.5", rem: "0.625rem", px: "10px" },
  { name: "3", rem: "0.75rem", px: "12px" },
  { name: "3.5", rem: "0.875rem", px: "14px" },
  { name: "4", rem: "1rem", px: "16px" },
  { name: "5", rem: "1.25rem", px: "20px" },
  { name: "6", rem: "1.5rem", px: "24px" },
  { name: "7", rem: "1.75rem", px: "28px" },
  { name: "8", rem: "2rem", px: "32px" },
  { name: "9", rem: "2.25rem", px: "36px" },
  { name: "10", rem: "2.5rem", px: "40px" },
  { name: "11", rem: "2.75rem", px: "44px" },
  { name: "12", rem: "3rem", px: "48px" },
  { name: "14", rem: "3.5rem", px: "56px" },
  { name: "16", rem: "4rem", px: "64px" },
  { name: "20", rem: "5rem", px: "80px" },
  { name: "24", rem: "6rem", px: "96px" },
  { name: "28", rem: "7rem", px: "112px" },
  { name: "32", rem: "8rem", px: "128px" },
  { name: "36", rem: "9rem", px: "144px" },
  { name: "40", rem: "10rem", px: "160px" },
  { name: "44", rem: "11rem", px: "176px" },
  { name: "48", rem: "12rem", px: "192px" },
  { name: "52", rem: "13rem", px: "208px" },
  { name: "56", rem: "14rem", px: "224px" },
  { name: "60", rem: "15rem", px: "240px" },
  { name: "64", rem: "16rem", px: "256px" },
  { name: "72", rem: "18rem", px: "288px" },
  { name: "80", rem: "20rem", px: "320px" },
  { name: "96", rem: "24rem", px: "384px" },
];

/** Max bar width for visual comparison (px) */
const MAX_BAR_WIDTH = 384;

function SpacingScale() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h2
        style={{
          fontFamily: "var(--typography-family-heading)",
          fontSize: "1.5rem",
          fontWeight: 700,
          borderBottom: "1px solid var(--color-semantic-border)",
          paddingBottom: "0.5rem",
        }}
      >
        Spacing Scale
      </h2>
      <p
        style={{
          fontFamily: "var(--typography-family-sans)",
          fontSize: "0.875rem",
          color: "var(--color-semantic-muted-foreground)",
        }}
      >
        Tailwind v4 default spacing (0.25rem / 4px base unit). Use as{" "}
        <code>p-4</code>, <code>gap-6</code>, <code>m-8</code> etc.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {spacingScale.map((item) => {
          const pxNum = parseInt(item.px, 10);
          const barWidth = Math.min(pxNum, MAX_BAR_WIDTH);
          return (
            <div
              key={item.name}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 100px 100px 1fr",
                alignItems: "center",
                padding: "0.25rem 0",
                gap: "0.5rem",
              }}
            >
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}
              >
                {item.name}
              </code>
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "var(--color-semantic-muted-foreground)",
                }}
              >
                {item.rem}
              </code>
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "var(--color-semantic-muted-foreground)",
                }}
              >
                {item.px}
              </code>
              <div
                style={{
                  height: "16px",
                  width: barWidth > 0 ? `${barWidth}px` : "2px",
                  backgroundColor:
                    barWidth > 0
                      ? "var(--color-semantic-primary)"
                      : "var(--color-semantic-muted-foreground)",
                  borderRadius: "var(--shape-radius-sm)",
                  opacity: barWidth > 0 ? 1 : 0.4,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const meta = {
  title: "Tokens/Spacing",
  component: SpacingScale,
  parameters: {
    layout: "padded",
    controls: { disable: true },
    actions: { disable: true },
  },
} satisfies Meta<typeof SpacingScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {};
