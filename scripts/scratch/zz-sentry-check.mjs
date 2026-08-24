// Read-only: list recent Sentry issues for elxea/elxea-web
import { readFileSync } from "node:fs";
const APP = "/Users/setaka/github/elxea/products/elxea-web-app";
function loadEnv(p) {
  const o = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}
const tok = loadEnv(`${APP}/.env.local`).SENTRY_AUTH_TOKEN || loadEnv(`${APP}/.env`).SENTRY_AUTH_TOKEN;
const res = await fetch(
  "https://sentry.io/api/0/projects/elxea/elxea-web/issues/?statsPeriod=24h&query=&limit=25",
  { headers: { Authorization: `Bearer ${tok}` } },
);
const json = await res.json();
console.log("http", res.status);
if (Array.isArray(json)) {
  for (const i of json) {
    console.log(
      [i.lastSeen, i.firstSeen, i.count, i.level, i.culprit, i.title].join(" | "),
    );
  }
} else {
  console.log(JSON.stringify(json).slice(0, 400));
}
