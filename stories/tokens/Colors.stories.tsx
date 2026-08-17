import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import React from "react";

import baseTokens from "../../tokens/base.json";

/**
 * Tokens/Colors — 色見本。
 *
 * 値は `tokens/base.json` から直接導出する。以前はトークン名と oklch 値を
 * この file に手書きしていたが、shadcn 既定値 (`oklch(1 0 0)` 等) のまま
 * 放置されて実際のトークンと完全に食い違っていた。手書きの見本は必ず
 * ドリフトするので、名前・値・並びをすべて生成側に寄せている。
 * ここに色を書き足さないこと (トークンを直せば見本も追随する)。
 */

type ColorLeaf = { $value: string; $description?: string };

function isColorLeaf(v: unknown): v is ColorLeaf {
  return typeof v === "object" && v !== null && typeof (v as ColorLeaf).$value === "string";
}

/** `color.semantic` / `color.brand` を {name, cssVar, value, description} に展開 */
function readGroup(group: Record<string, unknown>, cssVarPrefix: string) {
  const out: {
    name: string;
    cssVar: string;
    value: string;
    description?: string;
  }[] = [];
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith("$")) continue; // $type / $description はメタ
    if (!isColorLeaf(node)) continue;
    out.push({
      name: key,
      cssVar: `${cssVarPrefix}${key}`,
      value: node.$value,
      description: node.$description,
    });
  }
  return out;
}

const colorRoot = (baseTokens as { color: Record<string, Record<string, unknown>> }).color;

/** sd.config.mjs の命名規則: color.semantic.X → --color-X / color.brand.X → --color-brand-X */
const semanticTokens = readGroup(colorRoot.semantic, "--color-");
const brandTokens = readGroup(colorRoot.brand, "--color-brand-");

/** 見本の枠線が必要か = 面が地色に近いかどうかを oklch の L から機械判定する。
 *  以前は色名の文字列マッチ ("background" を含む等) で決めており、
 *  トークンが増えるたびに漏れていた。 */
function needsOutline(value: string): boolean {
  const m = /^oklch\(\s*([0-9.]+)/.exec(value);
  return m ? Number(m[1]) > 0.85 : false;
}

/** `primary` と `primary-foreground` を 1 枚のカードにまとめる */
function groupByRole(tokens: typeof semanticTokens) {
  const groups: Record<string, typeof semanticTokens> = {};
  for (const token of tokens) {
    const base = token.name.replace(/-foreground$/, "");
    (groups[base] ??= []).push(token);
  }
  return groups;
}

function Swatch({ token }: { token: (typeof semanticTokens)[number] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 0" }}>
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "var(--shape-radius-md)",
          backgroundColor: `var(${token.cssVar})`,
          border: needsOutline(token.value) ? "1px solid var(--color-border)" : "none",
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 }}>
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
            color: "var(--color-muted-foreground)",
            fontFamily: "monospace",
          }}
        >
          var({token.cssVar})
        </code>
        <code
          style={{
            fontSize: "0.75rem",
            color: "var(--color-muted-foreground)",
            fontFamily: "monospace",
          }}
        >
          {token.value}
        </code>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
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
          color: "var(--color-muted-foreground)",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2
        style={{
          fontFamily: "var(--typography-family-heading)",
          fontSize: "1.5rem",
          fontWeight: 700,
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "0.5rem",
        }}
      >
        {title}
      </h2>
      <p style={{ fontSize: "0.8125rem", color: "var(--color-muted-foreground)", margin: 0 }}>
        {note}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "2rem",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function ColorPalette() {
  const semanticGroups = groupByRole(semanticTokens);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3rem" }}>
      <Section
        title="Semantic"
        note={`tokens/base.json の color.semantic から自動生成 (${semanticTokens.length} 色)。値はこの file に書かず、トークン側を直すこと。`}
      >
        {Object.entries(semanticGroups).map(([role, tokens]) => (
          <Card key={role} title={role}>
            {tokens.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </Card>
        ))}
      </Section>

      <Section
        title="Brand"
        note={`tokens/base.json の color.brand から自動生成 (${brandTokens.length} 色)。semantic が参照する元のパレット。`}
      >
        <Card title="palette">
          {brandTokens.map((token) => (
            <Swatch key={token.name} token={token} />
          ))}
        </Card>
      </Section>
    </div>
  );
}

const meta = {
  title: "01 Foundations/Colors",
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
