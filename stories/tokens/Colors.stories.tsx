import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import React from "react";

const colorTokens = [
  { name: "background", cssVar: "--color-semantic-background", value: "oklch(1 0 0)" },
  { name: "foreground", cssVar: "--color-semantic-foreground", value: "oklch(0.145 0 0)" },
  { name: "card", cssVar: "--color-semantic-card", value: "oklch(1 0 0)" },
  { name: "card-foreground", cssVar: "--color-semantic-card-foreground", value: "oklch(0.145 0 0)" },
  { name: "popover", cssVar: "--color-semantic-popover", value: "oklch(1 0 0)" },
  { name: "popover-foreground", cssVar: "--color-semantic-popover-foreground", value: "oklch(0.145 0 0)" },
  { name: "primary", cssVar: "--color-semantic-primary", value: "oklch(0.205 0 0)" },
  { name: "primary-foreground", cssVar: "--color-semantic-primary-foreground", value: "oklch(0.985 0 0)" },
  { name: "secondary", cssVar: "--color-semantic-secondary", value: "oklch(0.97 0 0)" },
  { name: "secondary-foreground", cssVar: "--color-semantic-secondary-foreground", value: "oklch(0.205 0 0)" },
  { name: "muted", cssVar: "--color-semantic-muted", value: "oklch(0.97 0 0)" },
  { name: "muted-foreground", cssVar: "--color-semantic-muted-foreground", value: "oklch(0.556 0 0)" },
  { name: "accent", cssVar: "--color-semantic-accent", value: "oklch(0.97 0 0)" },
  { name: "accent-foreground", cssVar: "--color-semantic-accent-foreground", value: "oklch(0.205 0 0)" },
  { name: "destructive", cssVar: "--color-semantic-destructive", value: "oklch(0.577 0.245 27.325)" },
  { name: "destructive-foreground", cssVar: "--color-semantic-destructive-foreground", value: "oklch(0.985 0 0)" },
  { name: "border", cssVar: "--color-semantic-border", value: "oklch(0.922 0 0)" },
  { name: "input", cssVar: "--color-semantic-input", value: "oklch(0.922 0 0)" },
  { name: "ring", cssVar: "--color-semantic-ring", value: "oklch(0.708 0 0)" },
];

/** Group tokens by base name (e.g. "primary" groups primary + primary-foreground) */
function groupTokens() {
  const groups: Record<string, typeof colorTokens> = {};
  for (const token of colorTokens) {
    const base = token.name.replace(/-foreground$/, "");
    if (!groups[base]) groups[base] = [];
    groups[base].push(token);
  }
  return groups;
}

function Swatch({ token }: { token: (typeof colorTokens)[0] }) {
  const isLight =
    token.name.includes("background") ||
    token.name.includes("card") && !token.name.includes("foreground") ||
    token.name === "popover" ||
    token.name === "secondary" ||
    token.name === "muted" ||
    token.name === "accent" ||
    token.name === "primary-foreground" ||
    token.name === "destructive-foreground";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.75rem 0",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "var(--shape-radius-md)",
          backgroundColor: `var(${token.cssVar})`,
          border: isLight ? "1px solid var(--color-semantic-border)" : "none",
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        <span
          style={{
            fontWeight: 600,
            fontFamily: "var(--typography-family-sans)",
            fontSize: "0.875rem",
          }}
        >
          {token.name}
        </span>
        <code
          style={{
            fontSize: "0.75rem",
            color: "var(--color-semantic-muted-foreground)",
            fontFamily: "monospace",
          }}
        >
          var({token.cssVar})
        </code>
        <code
          style={{
            fontSize: "0.75rem",
            color: "var(--color-semantic-muted-foreground)",
            fontFamily: "monospace",
          }}
        >
          {token.value}
        </code>
      </div>
    </div>
  );
}

function ColorPalette() {
  const groups = groupTokens();

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
        Color Palette
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "2rem",
        }}
      >
        {Object.entries(groups).map(([groupName, tokens]) => (
          <div
            key={groupName}
            style={{
              border: "1px solid var(--color-semantic-border)",
              borderRadius: "var(--shape-radius-lg)",
              padding: "1rem",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--typography-family-heading)",
                fontSize: "0.875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "0.5rem",
                color: "var(--color-semantic-muted-foreground)",
              }}
            >
              {groupName}
            </h3>
            {tokens.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Tokens/Colors",
  component: ColorPalette,
  parameters: {
    layout: "padded",
    controls: { disable: true },
    actions: { disable: true },
  },
} satisfies Meta<typeof ColorPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Palette: Story = {};
