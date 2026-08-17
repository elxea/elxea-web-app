/**
 * T2 — static checks that keep the single source of truth actually single.
 *
 * Two independent scans over the same AST walk (the design folded the former T5
 * into this one: both are AST traversals, and one traversal with two collectors
 * is less to maintain than two walkers):
 *
 *  (i)  every cookie name we set is in the registry (or the explicit
 *       external-library list). An unknown name is a hard failure — a check that
 *       tolerates what it does not recognise is not a check.
 *  (ii) the origin-resolution env vars and any apex-shaped literal appear ONLY
 *       in `lib/base-url.ts` and `lib/auth/cookies.ts`. This is what stops a
 *       third source of truth growing back: the bug being fixed came from the
 *       same apex test being re-typed at three call sites fed by two different
 *       hostname sources.
 *
 * Plus a rewrite guard: a rewrite hop rewrites both `host` and
 * `x-forwarded-host` to the destination host (vercel/next.js#67469), which would
 * silently change what `resolveCookieDomain` sees. There are none today; this
 * fails if one is introduced without revisiting the Domain decision.
 *
 * `__tests__/__fixtures__` is excluded from the scan; the negative fixtures that
 * prove the scanner has teeth live there and are fed to it explicitly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  COOKIE_REGISTRY,
  EXTERNAL_LIBRARY_COOKIES,
  AUTH_COOKIE_APEX,
} from "@/lib/auth/cookies";

const ROOT = path.resolve(__dirname, "..");

/** Scanned surface. `middleware.ts` is included as a file, per the design. */
const SCAN_DIRS = ["app", "lib", "components"];
const SCAN_FILES = ["middleware.ts"];

/** Modules permitted to reference origin env vars / apex literals. */
const ORIGIN_OWNERS = [
  path.join("lib", "base-url.ts"),
  path.join("lib", "auth", "cookies.ts"),
];

const ORIGIN_ENV_VARS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXTAUTH_URL",
  "AUTH_COOKIE_APEX",
];

function walkFiles(target: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, target);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return out;
  }
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(abs)) out.push(abs);
    return out;
  }
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry === ".next") continue;
    walkFiles(path.join(target, entry), out);
  }
  return out;
}

/* Memoised. Without this the suite is quadratic: `resolveName` falls back to
 * searching every other module for a declaration, and re-walking + re-parsing the
 * whole tree per lookup pushed a single test past the 5s timeout once coverage
 * instrumentation was enabled. */
let sourceFilesCache: string[] | null = null;

function sourceFiles(): string[] {
  if (sourceFilesCache) return sourceFilesCache;
  const files: string[] = [];
  for (const d of SCAN_DIRS) walkFiles(d, files);
  for (const f of SCAN_FILES) walkFiles(f, files);
  sourceFilesCache = files.filter((f) => !f.includes(`${path.sep}__fixtures__${path.sep}`));
  return sourceFilesCache;
}

const parseCache = new Map<string, ts.SourceFile>();

function parseFile(abs: string): ts.SourceFile {
  const cached = parseCache.get(abs);
  if (cached) return cached;
  const sf = ts.createSourceFile(
    abs,
    readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  parseCache.set(abs, sf);
  return sf;
}

type Finding = { file: string; line: number; detail: string };

/**
 * Resolve a cookie-name expression to a literal.
 *
 * Handles string literals, template literals with no substitutions, and
 * identifiers/property accesses whose declaration in the same module is a
 * literal initialiser (`const CART_COOKIE = "shopify_cart_id"`, or a member of an
 * `as const` object such as `COOKIE_NAME.shopAccessToken`). Anything it cannot
 * resolve is reported rather than skipped — an unresolved name is exactly where a
 * rogue cookie would hide.
 */
function resolveName(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  const targetName = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isIdentifier(node)
      ? node.text
      : null;
  if (!targetName) return null;

  let found: string | null = null;

  const visit = (n: ts.Node) => {
    if (found !== null) return;

    // const NAME = "literal"
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === targetName &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    ) {
      found = n.initializer.text;
      return;
    }

    /* const NAME = COOKIE_NAME.someKey
     *
     * One hop through a property access. This is the shape the registry
     * encourages — call sites keep a local alias rather than repeating a bare
     * string — so the resolver has to follow it or every such site would be
     * reported as unresolved and the check would be unusable. */
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === targetName &&
      n.initializer &&
      ts.isPropertyAccessExpression(n.initializer)
    ) {
      found = resolveName(n.initializer, sf);
      return;
    }

    // { propName: "literal" } inside an object literal (e.g. COOKIE_NAME)
    if (
      ts.isPropertyAssignment(n) &&
      ((ts.isIdentifier(n.name) && n.name.text === targetName) ||
        (ts.isStringLiteralLike(n.name) && n.name.text === targetName)) &&
      ts.isStringLiteralLike(n.initializer)
    ) {
      found = n.initializer.text;
      return;
    }

    ts.forEachChild(n, visit);
  };

  visit(sf);
  if (found !== null) return found;

  // Imported constants: resolve from the module they are declared in.
  for (const other of sourceFiles()) {
    const otherSf = parseFile(other);
    let hit: string | null = null;
    const visitOther = (n: ts.Node) => {
      if (hit !== null) return;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === targetName &&
        n.initializer &&
        ts.isStringLiteralLike(n.initializer)
      ) {
        hit = n.initializer.text;
        return;
      }
      if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === targetName &&
        ts.isStringLiteralLike(n.initializer)
      ) {
        hit = n.initializer.text;
        return;
      }
      ts.forEachChild(n, visitOther);
    };
    visitOther(otherSf);
    if (hit !== null) return hit;
  }

  return null;
}

type ScanResult = {
  cookieNames: Finding[];
  unresolved: Finding[];
  originLeaks: Finding[];
  rewrites: Finding[];
};

function scan(files: string[]): ScanResult {
  const result: ScanResult = {
    cookieNames: [],
    unresolved: [],
    originLeaks: [],
    rewrites: [],
  };

  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    const sf = parseFile(abs);
    const lineOf = (n: ts.Node) =>
      sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const isOriginOwner = ORIGIN_OWNERS.some((o) => rel === o);

    const visit = (node: ts.Node) => {
      // --- (i) cookie names ------------------------------------------------
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression.getText(sf);
        const isCookieReceiver = /cookies$|cookieStore$|cookies\(\)$/.test(receiver);

        if ((method === "set" || method === "delete") && isCookieReceiver) {
          const first = node.arguments[0];
          if (first) {
            // delete({ name: ... }) / set({ name: ... })
            let nameNode: ts.Node = first;
            if (ts.isObjectLiteralExpression(first)) {
              const prop = first.properties.find(
                (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "name",
              );
              if (prop && ts.isPropertyAssignment(prop)) nameNode = prop.initializer;
            }
            const resolved = resolveName(nameNode, sf);
            if (resolved === null) {
              result.unresolved.push({
                file: rel,
                line: lineOf(node),
                detail: `${method}(${nameNode.getText(sf)})`,
              });
            } else {
              result.cookieNames.push({ file: rel, line: lineOf(node), detail: resolved });
            }
          }
        }
      }

      // document.cookie = `name=...`
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "cookie" &&
        /document$/.test(node.left.expression.getText(sf))
      ) {
        const raw = node.right.getText(sf);
        const m = raw.match(/^[`'"]?\$?\{?([A-Za-z0-9_.]+)\}?=/);
        if (m) {
          const candidate = m[1];
          const resolved = /^[a-z_]+$/i.test(candidate)
            ? (resolveName(
                ts.factory.createIdentifier(candidate),
                sf,
              ) ?? candidate)
            : candidate;
          result.cookieNames.push({ file: rel, line: lineOf(node), detail: resolved });
        } else {
          result.unresolved.push({ file: rel, line: lineOf(node), detail: raw.slice(0, 60) });
        }
      }

      // --- (ii) origin env vars + apex-shaped literals ---------------------
      if (!isOriginOwner) {
        if (
          ts.isPropertyAccessExpression(node) &&
          /process\.env$/.test(node.expression.getText(sf)) &&
          ORIGIN_ENV_VARS.includes(node.name.text)
        ) {
          result.originLeaks.push({
            file: rel,
            line: lineOf(node),
            detail: `process.env.${node.name.text}`,
          });
        }

        /* A leading-dot host literal is the Domain form. `lib/site-url.ts` has
         * `elxea.com` with no leading dot, which is a URL host rather than a
         * cookie Domain — matching the dot form keeps that out of scope. */
        if (ts.isStringLiteralLike(node) && /^\.[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(node.text)) {
          result.originLeaks.push({
            file: rel,
            line: lineOf(node),
            detail: `apex literal ${JSON.stringify(node.text)}`,
          });
        }
      }

      // --- rewrite guard ---------------------------------------------------
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        if (/NextResponse\.rewrite$/.test(callee) || /^rewrites$/.test(callee)) {
          result.rewrites.push({ file: rel, line: lineOf(node), detail: callee });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);

  }

  return result;
}

function format(findings: Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line} ${f.detail}`).join("\n");
}

const KNOWN = new Set<string>([
  ...COOKIE_REGISTRY.map((s) => s.name),
  ...EXTERNAL_LIBRARY_COOKIES,
]);

/* One scan of the real tree, shared by every describe below. */
const treeScan = scan(sourceFiles());

describe("T2 (i) — every cookie name we set is registered", () => {
  const result = treeScan;

  it("finds cookie set/delete sites at all (the scanner is not silently empty)", () => {
    expect(result.cookieNames.length).toBeGreaterThan(15);
  });

  it("resolves every cookie name to a literal", () => {
    expect(format(result.unresolved), "unresolved cookie names").toBe("");
  });

  it("has no unregistered cookie names", () => {
    const unknown = result.cookieNames.filter((f) => !KNOWN.has(f.detail));
    expect(format(unknown), "cookie names missing from the registry").toBe("");
  });

  it("has no registry entry that no longer corresponds to real code", () => {
    /* Guards the other direction: a stale registry would make the parity test
     * demand deletion of a cookie nothing issues, which is noise that erodes
     * trust in the check. `not-auth` entries are documentation of the full map
     * and are exempt from needing a set() site in the scanned dirs. */
    const seen = new Set(result.cookieNames.map((f) => f.detail));
    const orphaned = COOKIE_REGISTRY.filter(
      (s) => s.group !== "not-auth" && !seen.has(s.name),
    ).map((s) => s.name);
    expect(orphaned).toEqual([]);
  });
});

describe("T2 (ii) — origin resolution and apex literals stay in their two modules", () => {
  const result = treeScan;

  it("no origin env var or apex literal outside lib/base-url.ts and lib/auth/cookies.ts", () => {
    expect(format(result.originLeaks), "origin/apex references outside their owners").toBe("");
  });
});

describe("T2 — rewrite guard", () => {
  const result = treeScan;

  it("introduces no rewrite hop", () => {
    /* A rewrite rewrites BOTH `host` and `x-forwarded-host` to the destination
     * host (vercel/next.js#67469), so `resolveCookieDomain` would silently start
     * reading a host the user never addressed. If a rewrite is ever genuinely
     * needed, the cookie-Domain decision has to be revisited in the same change —
     * hence a failing test rather than a comment. */
    expect(format(result.rewrites), "rewrite hops found").toBe("");
  });
});

/**
 * T2n — the scanner has teeth.
 *
 * A static check that reports nothing is indistinguishable from a clean
 * codebase, so the two failure modes it exists to catch are committed as
 * fixtures and fed to the SAME scanner. They live under `app/__fixtures__/`,
 * inside the real search path, and are excluded from the normal walk (otherwise
 * T2 above would be permanently red). The App Router does not route `_`-prefixed
 * directories, so they are unreachable as URLs.
 *
 * Each fixture must trip its own check and NOT the other one — a scanner where
 * any bad file trips every rule cannot tell you what is actually wrong.
 */
describe("T2n — negative fixtures", () => {
  const fixture = (...p: string[]) => path.join(ROOT, "app", "__fixtures__", ...p);
  const unclassified = fixture("unclassified-cookie", "route-like.ts");
  const originLeak = fixture("origin-leak", "origin-like.ts");

  it("fixture (i) alone trips the registry check, and only that check", () => {
    const result = scan([unclassified]);
    const unknown = result.cookieNames.filter((f) => !KNOWN.has(f.detail));

    expect(unknown.map((f) => f.detail)).toEqual(["totally_unregistered_cookie"]);
    expect(format(result.originLeaks), "must not also trip the origin check").toBe("");
  });

  it("fixture (ii) alone trips the origin check, and only that check", () => {
    const result = scan([originLeak]);

    /* Deduplicated: the fixture spells `.elxea.com` twice (once in the
     * `endsWith` test, once as the returned Domain), which is itself
     * characteristic of the duplication this check exists to stop. What matters
     * is which KINDS of violation were reported. */
    expect([...new Set(result.originLeaks.map((f) => f.detail))].sort()).toEqual([
      'apex literal ".elxea.com"',
      "process.env.NEXT_PUBLIC_APP_URL",
    ]);
    expect(result.originLeaks.length).toBeGreaterThanOrEqual(2);
    const unknown = result.cookieNames.filter((f) => !KNOWN.has(f.detail));
    expect(format(unknown), "must not also trip the registry check").toBe("");
  });

  it("with both fixtures removed from the scan, the real tree is clean", () => {
    const result = treeScan;
    const unknown = result.cookieNames.filter((f) => !KNOWN.has(f.detail));

    expect(format(unknown)).toBe("");
    expect(format(result.originLeaks)).toBe("");
    expect(sourceFiles().some((f) => f.includes("__fixtures__"))).toBe(false);
  });
});

describe("T2 — the apex constant itself", () => {
  it("is a bare host with no leading dot", () => {
    expect(AUTH_COOKIE_APEX.startsWith(".")).toBe(false);
    expect(AUTH_COOKIE_APEX).not.toContain(":");
    expect(AUTH_COOKIE_APEX).not.toContain("/");
  });
});
