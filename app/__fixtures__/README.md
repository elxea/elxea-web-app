# Negative fixtures for the cookie-registry scanner

These files exist to be **rejected**. `__tests__/auth-cookie-registry.test.ts`
excludes this directory from its normal walk and feeds these files to the same
scanner explicitly, asserting that each one is reported. Without that, a scanner
bug that made it report nothing would look exactly like a clean codebase.

They live under `app/` on purpose: that is inside the scanner's real search path,
so they exercise the same traversal as production code rather than a
special-cased one. The App Router does not route directories whose name begins
with `_`, so nothing here is reachable as a URL.
