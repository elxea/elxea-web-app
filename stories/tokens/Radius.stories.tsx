import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import React from "react";

const radiusTokens = [
  { name: "sm", cssVar: "--shape-radius-sm", value: "0.25rem / 4px" },
  { name: "md", cssVar: "--shape-radius-md", value: "0.375rem / 6px" },
  { name: "lg", cssVar: "--shape-radius-lg", value: "0.5rem / 8px" },
  { name: "xl", cssVar: "--shape-radius-xl", value: "0.75rem / 12px" },
];

function RadiusScale() {
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
        Border Radius
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {radiusTokens.map((token) => (
          <div
            key={token.name}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                width: "120px",
                height: "120px",
                backgroundColor: "var(--color-semantic-primary)",
                borderRadius: `var(${token.cssVar})`,
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.125rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--typography-family-sans)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                {token.name}
              </span>
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "var(--color-semantic-muted-foreground)",
                }}
              >
                var({token.cssVar})
              </code>
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "var(--color-semantic-muted-foreground)",
                }}
              >
                {token.value}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Tokens/Radius",
  component: RadiusScale,
  parameters: {
    layout: "padded",
    controls: { disable: true },
    actions: { disable: true },
  },
} satisfies Meta<typeof RadiusScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {};
