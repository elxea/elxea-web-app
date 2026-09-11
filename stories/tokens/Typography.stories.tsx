import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import React from "react";

const typographyScale = [
  {
    tag: "h1",
    label: "Heading 1",
    size: "2.25rem / 36px",
    lineHeight: "2.5rem / 40px",
    weight: 700,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "h2",
    label: "Heading 2",
    size: "1.875rem / 30px",
    lineHeight: "2.25rem / 36px",
    weight: 700,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "h3",
    label: "Heading 3",
    size: "1.5rem / 24px",
    lineHeight: "2rem / 32px",
    weight: 600,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "h4",
    label: "Heading 4",
    size: "1.25rem / 20px",
    lineHeight: "1.75rem / 28px",
    weight: 600,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "h5",
    label: "Heading 5",
    size: "1.125rem / 18px",
    lineHeight: "1.75rem / 28px",
    weight: 600,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "h6",
    label: "Heading 6",
    size: "1rem / 16px",
    lineHeight: "1.5rem / 24px",
    weight: 600,
    font: "var(--typography-family-heading)",
    fontLabel: "aktiv-grotesk-extended / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "p",
    label: "Body (base)",
    size: "1rem / 16px",
    lineHeight: "1.5rem / 24px",
    weight: 400,
    font: "var(--typography-family-sans)",
    fontLabel: "aktiv-grotesk / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "p",
    label: "Body (lg)",
    size: "1.125rem / 18px",
    lineHeight: "1.75rem / 28px",
    weight: 400,
    font: "var(--typography-family-sans)",
    fontLabel: "aktiv-grotesk / dnp-shuei-gothic-gin-std",
    className: "text-lg",
  },
  {
    tag: "small",
    label: "Small",
    size: "0.875rem / 14px",
    lineHeight: "1.25rem / 20px",
    weight: 400,
    font: "var(--typography-family-sans)",
    fontLabel: "aktiv-grotesk / dnp-shuei-gothic-gin-std",
  },
  {
    tag: "p",
    label: "Extra Small (xs)",
    size: "0.75rem / 12px",
    lineHeight: "1rem / 16px",
    weight: 400,
    font: "var(--typography-family-sans)",
    fontLabel: "aktiv-grotesk / dnp-shuei-gothic-gin-std",
    className: "text-xs",
  },
];

function TypographyScale() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h2
        style={{
          fontFamily: "var(--typography-family-heading)",
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "0.5rem",
          borderBottom: "1px solid var(--color-semantic-border)",
          paddingBottom: "0.5rem",
        }}
      >
        Typography Scale
      </h2>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--typography-family-sans)",
        }}
      >
        <thead>
          <tr
            style={{
              textAlign: "left",
              borderBottom: "2px solid var(--color-semantic-border)",
            }}
          >
            <th style={{ padding: "0.5rem 1rem" }}>Sample</th>
            <th style={{ padding: "0.5rem 1rem" }}>Tag / Class</th>
            <th style={{ padding: "0.5rem 1rem" }}>Size</th>
            <th style={{ padding: "0.5rem 1rem" }}>Line Height</th>
            <th style={{ padding: "0.5rem 1rem" }}>Weight</th>
            <th style={{ padding: "0.5rem 1rem" }}>Font Family</th>
          </tr>
        </thead>
        <tbody>
          {typographyScale.map((item, i) => {
            const Tag = item.tag as keyof React.JSX.IntrinsicElements;
            return (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid var(--color-semantic-border)",
                  verticalAlign: "baseline",
                }}
              >
                <td style={{ padding: "0.75rem 1rem" }}>
                  <Tag
                    className={item.className}
                    style={{ fontFamily: item.font, fontWeight: item.weight, margin: 0 }}
                  >
                    {item.label}
                  </Tag>
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {"<"}
                  {item.tag}
                  {">"}
                  {item.className ? ` .${item.className}` : ""}
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {item.size}
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {item.lineHeight}
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {item.weight}
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    fontSize: "0.75rem",
                    maxWidth: "200px",
                  }}
                >
                  {item.fontLabel}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const meta = {
  title: "Tokens/Typography",
  component: TypographyScale,
  parameters: {
    layout: "padded",
    controls: { disable: true },
    actions: { disable: true },
  },
} satisfies Meta<typeof TypographyScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {};
