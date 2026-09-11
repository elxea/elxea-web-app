import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The shared-domain expiry guard has one way past it, and nothing else in the
 * repo notices.
 *
 * `expireAtBothScopes` installs the guard by defining an own `cookies` data
 * property on the response, shadowing the `get cookies()` accessor inherited
 * from `NextResponse.prototype` (`lib/auth/cookies.ts`, `installSharedDomainExpiryGuard`).
 * Every later `response.cookies.set(...)` therefore goes through the wrapper and
 * re-flushes the pending shared-Domain expiry.
 *
 * It shadows the property, not the jar. So a reference taken BEFORE the guard is
 * installed still points at the inner Proxy:
 *
 *     const jar = res.cookies;      // inner jar, captured pre-install
 *     clearSessionCookies(res);     // guard installed here
 *     jar.set("sid", value);        // re-serialises WITHOUT the guard
 *
 * Measured on this branch, that one line takes the emitted `Domain=` lines from
 * 10 to 0 — i.e. it silently reinstates the exact defect the guard exists to
 * prevent. No type error, no lint error, no failing test.
 *
 * ## Why a repo scan rather than a runtime assertion
 *
 * The bypass cannot be closed from inside the guard: the inner Proxy cannot be
 * wrapped in place (the trap would re-enter itself — see the comment above
 * `installSharedDomainExpiryGuard`), and a response's jar is reachable before
 * any auth code runs, so there is no moment at which the module could take
 * ownership of it. The guard can only defend the property, never a copy already
 * taken. What remains is to make the copy visible.
 *
 * ## Why the population is "files that import the cookie module"
 *
 * Membership is derived, not listed, so the check extends itself to auth code
 * added later without anyone remembering to register it — and it stays off
 * everything else, which is what keeps it quiet. Measured against the tree as
 * of this commit it flags nothing, so a red result means a new binding, not
 * accumulated noise. In particular it does NOT flag `request.cookies.get(...)`
 * (a read from the request jar, of which there are 7 today): the pattern is a
 * binding of the jar itself.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const COOKIE_MODULE = "lib/auth/cookies.ts";

/** `const x = <expr>.cookies` / `const { set } = <expr>.cookies` — the jar
 * itself being bound, not a property read through it. The trailing lookahead is
 * what separates `const jar = res.cookies` from `const v = request.cookies.get(n)`. */
const JAR_BINDING =
  /\b(?:const|let|var)\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[A-Za-z_$][\w$]*\.cookies\s*(?![\w$.([])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function sourceFiles(): string[] {
  return [...walk(path.join(REPO_ROOT, "app")), ...walk(path.join(REPO_ROOT, "lib"))];
}

/** Files that import the cookie module — i.e. the auth surface the guard covers. */
function guardedFiles(): string[] {
  const importsCookieModule = /from\s+["'](?:@\/lib\/auth\/cookies|\.{1,2}(?:\/[\w.-]+)*\/cookies)["']/;
  return sourceFiles().filter((f) => importsCookieModule.test(readFileSync(f, "utf8")));
}

function bindingsIn(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter((l) => JAR_BINDING.test(l.text));
}

describe("cookie-guard bypass detector", () => {
  it("covers every file that imports the cookie module", () => {
    const files = guardedFiles().map((f) => path.relative(REPO_ROOT, f));
    // Sanity: an empty population would make the check below vacuously green.
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain("app/api/line-callback/route.ts");
    expect(files).toContain("app/api/line-login/init/route.ts");
  });

  it("no auth file binds a response cookie jar to a local variable", () => {
    const offenders = guardedFiles().flatMap((file) =>
      bindingsIn(file).map((l) => `${path.relative(REPO_ROOT, file)}:${l.line}  ${l.text}`),
    );

    expect(
      offenders,
      [
        "A cookie jar is bound to a local variable in auth code.",
        "If the binding is taken before clearSessionCookies()/expireAtBothScopes()",
        "installs the shared-domain expiry guard, writes through it skip the guard",
        "and the Domain= expiry lines are silently dropped.",
        "Call response.cookies.set(...) on the response each time instead.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("the cookie module itself has exactly one such binding — the guard installer", () => {
    // `installSharedDomainExpiryGuard` legitimately reads the inner jar once, to
    // build the outer Proxy that shadows it. That single site is the reason the
    // module is not simply included in the scan above. Pinning the count means a
    // SECOND binding appearing inside the module still turns this red.
    const bindings = bindingsIn(path.join(REPO_ROOT, COOKIE_MODULE));
    expect(bindings.map((b) => b.text)).toEqual(["const jar = response.cookies;"]);
  });

  it("detects the bypass shape, and does not fire on ordinary request reads", () => {
    // Proof the detector works, without leaving a violation in the tree.
    expect(JAR_BINDING.test("const jar = res.cookies;")).toBe(true);
    expect(JAR_BINDING.test("let jar = response.cookies")).toBe(true);
    expect(JAR_BINDING.test("const { set } = response.cookies;")).toBe(true);
    expect(JAR_BINDING.test("const jar = response.cookies")).toBe(true);

    expect(JAR_BINDING.test('const v = request.cookies.get("sid")?.value;')).toBe(false);
    expect(JAR_BINDING.test("const cookieStore = await cookies();")).toBe(false);
    expect(JAR_BINDING.test('response.cookies.set("sid", value);')).toBe(false);
    expect(JAR_BINDING.test("const all = request.cookies.getAll();")).toBe(false);
  });
});
