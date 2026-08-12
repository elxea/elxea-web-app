/**
 * Firestore 複合インデックスを `firestore.indexes.json` の定義に合わせて反映する。
 *
 *   pnpm deploy:indexes           # 差分を確認して不足分を作成
 *   pnpm deploy:indexes --dry-run # 作成せず差分だけ表示
 *
 * ## なぜこのスクリプトが必要か
 *
 * `firestore.indexes.json` はアプリのデプロイ (Vercel) では一切反映されない。
 * Firestore 側へ別途反映しないと、索引を要求するクエリだけが
 * FAILED_PRECONDITION で失敗し続ける。実際に「人気の記事」がこれで無言のまま
 * 空になっていた (QA 指摘 / 2026-08-12)。反映工程がどのワークフローにも無く、
 * 手順も口伝だったので、リポジトリ内に実行可能な形で固定する。
 *
 * `firebase deploy --only firestore:indexes` でも同じことができるが、あちらは
 * `firebase login` による対話ログイン (ブラウザ) を前提とする。CI やエージェント
 * から実行できないので、**アプリが既に持っているサービスアカウント**
 * (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) で
 * Firestore Admin REST API を直接叩く。新しい認証情報も新しい依存も要らない。
 *
 * 必要な権限: サービスアカウントに `datastore.indexes.list` /
 * `datastore.indexes.create` (roles/datastore.owner 等)。権限が無い場合は
 * 403 を明示して終了する (黙って成功扱いにはしない)。
 *
 * ## 冪等性
 *
 * 既存インデックスと定義を突き合わせ、**不足分だけ**作成する。Firestore は
 * 複合インデックスに `__name__` を自動で足すため、比較時にはそれを除いて
 * 照合する。既に存在するものを再作成しようとすると 409 になるが、その場合も
 * 「既にある」として成功扱いにする (競合実行に耐える)。
 *
 * インデックス作成は非同期。作成要求が受理されると state=CREATING で返り、
 * READY になるまで数分かかる。本スクリプトは受理までを保証し、最後に各
 * インデックスの state を表示する。
 */

import { createSign } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { decodePrivateKey } from "../lib/firebase/admin";

// ─── 型 ──────────────────────────────────────────────────────

type IndexOrder = "ASCENDING" | "DESCENDING";

type IndexFieldSpec = {
  fieldPath: string;
  order?: IndexOrder;
  arrayConfig?: "CONTAINS";
};

type IndexSpec = {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexFieldSpec[];
};

type RemoteIndex = {
  name?: string;
  queryScope?: string;
  state?: string;
  fields?: IndexFieldSpec[];
};

// ─── env ─────────────────────────────────────────────────────

/**
 * env は process.env を優先し、無ければ `.env.local` → `.env` を読む
 * (このリポジトリの既存スクリプトと同じ流儀。dotenv は依存に無い)。
 */
function loadEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];

  for (const file of [".env.local", ".env"]) {
    let content: string;
    try {
      content = readFileSync(join(process.cwd(), file), "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && match[1].trim() === key) {
        return match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
}

// ─── 認証 (サービスアカウント JWT → OAuth2 アクセストークン) ──

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(privateKey));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `サービスアカウントのトークン取得に失敗 (HTTP ${res.status}): ${body.error ?? "unknown"}`
    );
  }
  return body.access_token;
}

// ─── Firestore Admin REST ────────────────────────────────────

function indexesUrl(projectId: string, collectionGroup: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${collectionGroup}/indexes`;
}

/** 比較用に「Firestore が自動で足す `__name__` を除いた」フィールド列を作る。 */
function comparableFields(fields: IndexFieldSpec[] | undefined): string {
  return (fields ?? [])
    .filter((f) => f.fieldPath !== "__name__")
    .map((f) => `${f.fieldPath}:${f.arrayConfig ?? f.order ?? "ASCENDING"}`)
    .join(",");
}

function sameIndex(spec: IndexSpec, remote: RemoteIndex): boolean {
  return (
    (remote.queryScope ?? "COLLECTION") === spec.queryScope &&
    comparableFields(remote.fields) === comparableFields(spec.fields)
  );
}

async function listIndexes(
  token: string,
  projectId: string,
  collectionGroup: string
): Promise<RemoteIndex[]> {
  const res = await fetch(indexesUrl(projectId, collectionGroup), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `インデックス一覧の取得に失敗 (${collectionGroup}, HTTP ${res.status}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { indexes?: RemoteIndex[] };
  return body.indexes ?? [];
}

/** 作成要求を投げる。既に存在する (409) 場合は作成不要として扱う。 */
async function createIndex(
  token: string,
  projectId: string,
  spec: IndexSpec
): Promise<"created" | "already-exists"> {
  const res = await fetch(indexesUrl(projectId, spec.collectionGroup), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queryScope: spec.queryScope, fields: spec.fields }),
  });

  if (res.ok) return "created";
  if (res.status === 409) return "already-exists";
  throw new Error(
    `インデックス作成に失敗 (${spec.collectionGroup} / ${comparableFields(spec.fields)}, HTTP ${res.status}): ${await res.text()}`
  );
}

// ─── main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const projectId = loadEnv("FIREBASE_PROJECT_ID");
  const clientEmail = loadEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = decodePrivateKey(loadEnv("FIREBASE_PRIVATE_KEY"));

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY が必要です " +
        `(projectId=${!!projectId}, clientEmail=${!!clientEmail}, privateKey=${!!privateKey})。` +
        "\n本番の値は `vercel env pull --environment=production <file>` で取得できます。"
    );
    process.exit(1);
  }

  const definitionPath = join(process.cwd(), "firestore.indexes.json");
  const definition = JSON.parse(readFileSync(definitionPath, "utf-8")) as {
    indexes: IndexSpec[];
  };

  console.log(
    `[deploy-indexes] project=${projectId} 定義=${definition.indexes.length} 件${dryRun ? " (dry-run)" : ""}`
  );

  const token = await getAccessToken(clientEmail, privateKey);

  // collectionGroup ごとに一覧を 1 回だけ取る。
  const groups = [...new Set(definition.indexes.map((i) => i.collectionGroup))];
  const remoteByGroup = new Map<string, RemoteIndex[]>();
  for (const group of groups) {
    remoteByGroup.set(group, await listIndexes(token, projectId, group));
  }

  let created = 0;
  let existing = 0;

  for (const spec of definition.indexes) {
    const remote = remoteByGroup.get(spec.collectionGroup) ?? [];
    const match = remote.find((r) => sameIndex(spec, r));
    const label = `${spec.collectionGroup} [${spec.queryScope}] ${comparableFields(spec.fields)}`;

    if (match) {
      existing += 1;
      console.log(`  [OK] ${label} (state=${match.state ?? "unknown"})`);
      continue;
    }

    if (dryRun) {
      console.log(`  [MISSING] ${label}`);
      continue;
    }

    const result = await createIndex(token, projectId, spec);
    created += 1;
    console.log(
      `  [${result === "created" ? "CREATED" : "EXISTS"}] ${label}` +
        (result === "created" ? " (state=CREATING / READY まで数分かかります)" : "")
    );
  }

  console.log(
    `[deploy-indexes] 既存 ${existing} 件 / ${dryRun ? "不足" : "作成"} ${dryRun ? definition.indexes.length - existing : created} 件`
  );

  if (dryRun && existing !== definition.indexes.length) {
    // dry-run は「差分あり」を終了コードで表せるようにする (CI でのドリフト検知用)。
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(
    `[deploy-indexes] 失敗: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
