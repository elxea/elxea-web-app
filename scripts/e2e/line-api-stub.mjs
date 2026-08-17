/* LINE API stub for Ring 2.
 *
 * Stands in for api.line.me so the /api/line-callback SUCCESS path can be driven
 * end to end. Those calls are made server-side, so Playwright cannot intercept
 * them — without this the only reachable outcomes are the error redirects, which
 * is exactly the blind spot that let a change destroying the session cookies this
 * route issues pass a fully green suite.
 *
 * Returns fixed, obviously-synthetic values. No credential is involved.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 3312);

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // Readiness probe.
  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (pathname === "/oauth2/v2.1/token") {
    return json(200, { access_token: "stub-access-token", id_token: "stub-id-token", expires_in: 3600 });
  }
  if (pathname === "/v2/profile") {
    return json(200, { userId: "U-ring2-user", displayName: "RingTwoUser" });
  }
  if (pathname === "/oauth2/v2.1/verify") {
    return json(200, { email: "ring2@example.test" });
  }
  // cx-agent identity link lands here too; acknowledging is enough.
  return json(200, {});
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`line stub listening on 127.0.0.1:${PORT}\n`);
});
