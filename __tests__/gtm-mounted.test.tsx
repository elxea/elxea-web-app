import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Regression guard for the defect that cost ~4 months of analytics:
 * `components/analytics/gtm.tsx` existed and `NEXT_PUBLIC_GTM_ID` was set in
 * Vercel, but nothing ever rendered the component, so no page carried a
 * measurement tag. See deliverables/ga4-searchconsole-repair.md §1 (1).
 *
 * The check is on the ROOT layout on purpose: it is the single node every
 * route tree (`[locale]`, `dev`, `(studio)`, `password`) passes through, so a
 * new route tree cannot silently ship untagged.
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

async function renderRootLayout(): Promise<string> {
  const { default: RootLayout } = await import("@/app/layout");
  return renderToStaticMarkup(
    <RootLayout>
      <div id="page" />
    </RootLayout>
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("root layout mounts Google Tag Manager", () => {
  it("emits the GTM bootstrap and the noscript fallback when the id is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123");
    vi.resetModules();

    const html = await renderRootLayout();

    expect(html).toContain('id="gtm-script"');
    expect(html).toContain("'dataLayer','GTM-TEST123'");
    expect(html).toContain(
      "https://www.googletagmanager.com/ns.html?id=GTM-TEST123"
    );
    // The children still render — the tag is additive, not a replacement.
    expect(html).toContain('id="page"');
  });

  it("trims a container id that carries a trailing newline", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123\n");
    vi.resetModules();

    const html = await renderRootLayout();

    expect(html).toContain(
      "https://www.googletagmanager.com/ns.html?id=GTM-TEST123"
    );
    expect(html).not.toMatch(/id=GTM-TEST123\s/);
  });

  it("renders nothing GTM-related when the id is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
    vi.resetModules();

    const html = await renderRootLayout();

    expect(html).not.toContain("googletagmanager.com");
    expect(html).toContain('id="page"');
  });
});
