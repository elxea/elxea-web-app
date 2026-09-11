import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Two regression guards on the same component, from two opposite failures:
 *
 *  1. GTM must be MOUNTED. `components/analytics/gtm.tsx` existed and
 *     `NEXT_PUBLIC_GTM_ID` was set in Vercel, but nothing rendered it, so no
 *     page carried a measurement tag for ~4 months.
 *     See deliverables/ga4-searchconsole-repair.md §1 (1).
 *     The check is on the ROOT layout on purpose: it is the single node every
 *     route tree (`[locale]`, `dev`, `(studio)`, `password`) passes through, so
 *     a new route tree cannot silently ship untagged.
 *
 *  2. GTM must be CONSENT-GATED. Once mounted it loaded unconditionally, so
 *     "必要なもののみ" did nothing. Server-rendered HTML must therefore carry no
 *     GTM at all — the container may only appear on the client, after the
 *     stored choice has been read.
 *
 * The in-browser half of (2) — declined stays untagged, accepted gets tagged —
 * is covered in e2e/cookie-consent.spec.ts, which asserts on real network
 * requests.
 */

// next/script's real implementation needs the Next runtime context. We only
// care that the component tree *contains* the GTM script with the right id, so
// render it as a plain <script> carrying the same props.
vi.mock("next/script", () => ({
  default: ({
    id,
    dangerouslySetInnerHTML,
  }: {
    id?: string;
    dangerouslySetInnerHTML?: { __html: string };
  }) => <script id={id} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />,
}));

/** Names of the component functions rendered anywhere in `node`'s tree. */
function componentNames(node: ReactNode, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) componentNames(child, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.name) {
    found.add(element.type.name);
  }
  componentNames(element.props?.children, found);
  return found;
}

async function renderRootLayout(): Promise<string> {
  const { default: RootLayout } = await import("@/app/layout");
  return renderToStaticMarkup(
    <RootLayout>
      <div id="page" />
    </RootLayout>
  );
}

async function rootLayoutTree(): Promise<ReactNode> {
  const { default: RootLayout } = await import("@/app/layout");
  return RootLayout({ children: <div id="page" /> }) as ReactNode;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("root layout mounts Google Tag Manager", () => {
  it("still renders the GTM component in the tree", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123");
    vi.resetModules();

    expect(componentNames(await rootLayoutTree())).toContain("GoogleTagManager");
  });

  it("emits no GTM on the server, because consent is unknown there", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123");
    vi.resetModules();

    const html = await renderRootLayout();

    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain('id="gtm-script"');
    // The children still render — the gate is additive, not a replacement.
    expect(html).toContain('id="page"');
  });
});

describe("GoogleTagManagerScript", () => {
  async function renderScript(): Promise<string> {
    const { GoogleTagManagerScript } = await import("@/components/analytics/gtm");
    return renderToStaticMarkup(<GoogleTagManagerScript />);
  }

  it("emits the GTM bootstrap and the noscript fallback when the id is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123");
    vi.resetModules();

    const html = await renderScript();

    expect(html).toContain('id="gtm-script"');
    expect(html).toContain("'dataLayer','GTM-TEST123'");
    expect(html).toContain("https://www.googletagmanager.com/ns.html?id=GTM-TEST123");
  });

  it("trims a container id that carries a trailing newline", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123\n");
    vi.resetModules();

    const html = await renderScript();

    expect(html).toContain("https://www.googletagmanager.com/ns.html?id=GTM-TEST123");
    expect(html).not.toMatch(/id=GTM-TEST123\s/);
  });

  it("renders nothing GTM-related when the id is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
    vi.resetModules();

    expect(await renderScript()).toBe("");
  });
});
