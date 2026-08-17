/* Contract stub for Shopify RP-initiated logout (stage 0b).
 *
 * Encodes exactly one belief: Shopify rejects an RP-initiated logout that
 * carries no `id_token_hint`. Runs as a real HTTP server rather than a
 * Playwright `route` handler because route interception was measured NOT to see
 * the cross-origin hop of a top-level navigation redirect (2026-08-18 01:12
 * JST: catch-all route logged the /api/auth/logout navigation but never the
 * redirect target; the browser resolved DNS for it instead).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 3311);
const LOG = process.argv[3] ?? "/dev/stderr";
fs.mkdirSync(path.dirname(LOG), { recursive: true });

let hits = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  /* Readiness probe. The logout path cannot serve this role: it answers 400 to a
   * hint-less request — that is its contract — and Playwright's webServer would
   * read a 400 as "not started yet" and time out. */
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }

  if (!/\/authentication\/(\d+\/)?logout$/.test(url.pathname)) {
    res.writeHead(404).end("not-a-stubbed-path");
    return;
  }
  hits += 1;
  const hint = url.searchParams.get("id_token_hint");
  const post = url.searchParams.get("post_logout_redirect_uri");
  const line = JSON.stringify({
    hits,
    path: url.pathname,
    hasIdTokenHint: Boolean(hint),
    hasPostLogoutRedirectUri: Boolean(post),
    verdict: hint ? 302 : 400,
  });
  fs.appendFileSync(LOG, line + "\n");
  if (!hint) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("invalid_request: id_token_hint required");
    return;
  }
  res.writeHead(302, { location: post ?? "/" });
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`stub listening on 127.0.0.1:${PORT}\n`);
});
