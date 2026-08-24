import fs from "node:fs";
import crypto from "node:crypto";
const line = fs.readFileSync("/Users/setaka/github/elxea/products/elxea-web-app/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("SITE_PASSWORD=")) || "";
const pw = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
process.stdout.write(crypto.createHmac("sha256", pw).update(pw).digest("hex"));
